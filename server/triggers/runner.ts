import type { Database } from "bun:sqlite";
import { isGuideKind, type GuideKind } from "../../shared/types.ts";
import { TRACKER_KINDS } from "../tasks/registry.ts";
import type { GuideRunner } from "../guides/runner.ts";
import type { TrackerRunner } from "../trackers/runner.ts";
import { listTriggers } from "../db/queries/triggers.ts";
import { listScripts } from "../db/queries/scripts.ts";
import { findMessageById, updateMessage, type SceneRow } from "../db/queries/history.ts";
import { applyScripts } from "../scripts/apply.ts";
import { scriptContext, speakerOf } from "../scripts/runtime.ts";
import { triggersFor, type EventTrigger, type TriggerEvent } from "./select.ts";

/**
 * Running §14's event triggers.
 *
 * The selector decides what fires; this decides what firing means. Three
 * actions, and each is a call into machinery that already exists — a trigger is
 * a schedule, not a second implementation of anything.
 *
 * Nothing here throws. A trigger is automation the user set up once and will
 * not be watching, and the failure mode of automation that can break a turn is
 * a scene that stops working for a reason nobody can see. Each outcome says
 * what happened instead, which is what the routes report and what §18 calls
 * degrading visibly.
 */

export interface TriggerOutcome {
  triggerId: string;
  name: string;
  action: EventTrigger["action"];
  ran: boolean;
  /** Why it did not run, or what it changed. One line, for the log. */
  detail: string;
}

export interface TriggerRunnerOptions {
  db: Database;
  guides: GuideRunner;
  trackers: TrackerRunner;
}

export class TriggerRunner {
  private readonly db: Database;
  private readonly guides: GuideRunner;
  private readonly trackers: TrackerRunner;
  private stopped = false;

  constructor(options: TriggerRunnerOptions) {
    this.db = options.db;
    this.guides = options.guides;
    this.trackers = options.trackers;
  }

  shutdown(): void {
    this.stopped = true;
  }

  /**
   * Whether anything at all is bound to this event.
   *
   * Called on the hot paths before the scene is re-read, so an install with no
   * triggers — which is every install until someone writes one — pays one
   * indexed query per turn rather than a scene load.
   */
  anyFor(event: TriggerEvent): boolean {
    const row = this.db
      .query("SELECT 1 AS hit FROM event_triggers WHERE event = $event AND enabled = 1 LIMIT 1")
      .get({ event }) as { hit: number } | null;
    return row !== null;
  }

  async fire(
    event: TriggerEvent,
    where: { scene: SceneRow; automationIds?: readonly string[] },
  ): Promise<TriggerOutcome[]> {
    if (this.stopped) return [];
    const selected = triggersFor(listTriggers(this.db), {
      event,
      sceneId: where.scene.ulid,
      ...(where.automationIds === undefined ? {} : { automationIds: where.automationIds }),
    });

    const outcomes: TriggerOutcome[] = [];
    for (const trigger of selected) {
      if (this.stopped) break;
      outcomes.push(await this.run(trigger, where.scene));
    }
    return outcomes;
  }

  private async run(trigger: EventTrigger, scene: SceneRow): Promise<TriggerOutcome> {
    const base = { triggerId: trigger.id, name: trigger.name, action: trigger.action };
    try {
      switch (trigger.action) {
        case "guide": {
          if (!isGuideKind(trigger.actionRef)) {
            return { ...base, ran: false, detail: `${trigger.actionRef} is not a guide.` };
          }
          // `automatic: false` on purpose: a trigger *is* the ask. Requiring the
          // guide's own auto-trigger as well would mean the user switched a
          // guide off the automatic path and then wondered why the trigger they
          // wrote to run it by hand did nothing.
          await this.guides.refresh(scene, {
            kinds: [trigger.actionRef as GuideKind],
            automatic: false,
          });
          return { ...base, ran: true, detail: `Refreshed the ${trigger.actionRef} guide.` };
        }

        case "tracker": {
          const kinds = TRACKER_KINDS as readonly string[];
          if (!kinds.includes(trigger.actionRef)) {
            return { ...base, ran: false, detail: `${trigger.actionRef} is not a tracker.` };
          }
          await this.trackers.refresh(scene, {
            kinds: [trigger.actionRef as (typeof TRACKER_KINDS)[number]],
            automatic: false,
          });
          return { ...base, ran: true, detail: `Refreshed the ${trigger.actionRef} tracker.` };
        }

        case "script":
          return { ...base, ...this.runScript(trigger, scene) };
      }
    } catch (error) {
      return {
        ...base,
        ran: false,
        detail: error instanceof Error ? error.message : "It failed.",
      };
    }
  }

  /**
   * Fire a regex script over the scene's newest turn, in place.
   *
   * The four stages in §14 run at fixed points; this is what a trigger adds — a
   * rewrite that happens because a lore entry activated, or because the reader
   * spoke, rather than because a message was on its way in or out.
   *
   * The script's own stage and enabled flag are ignored here, deliberately: a
   * script written to be fired by a trigger should be switched off on the
   * automatic paths, and requiring it to be on would make it run twice.
   */
  private runScript(
    trigger: EventTrigger,
    scene: SceneRow,
  ): { ran: boolean; detail: string } {
    const script = listScripts(this.db).find((row) => row.id === trigger.actionRef);
    if (script === undefined) return { ran: false, detail: "That script has been deleted." };

    const leaf = scene.active_leaf_id === null ? null : findMessageById(this.db, scene.active_leaf_id);
    if (leaf === null) return { ran: false, detail: "Nothing has been written yet." };

    const context = scriptContext(this.db, scene.id);
    const speaker = speakerOf(this.db, leaf.character_id);
    const result = applyScripts(leaf.content, [script], {
      ...context.env,
      char: speaker.name,
    });
    const first = result.runs[0];
    if (first?.error != null) return { ran: false, detail: first.error };
    if (result.text === leaf.content) return { ran: true, detail: "Nothing matched." };

    updateMessage(this.db, leaf.id, { content: result.text });
    const count = first?.replacements ?? 0;
    return { ran: true, detail: `Rewrote ${count} ${count === 1 ? "match" : "matches"}.` };
  }
}
