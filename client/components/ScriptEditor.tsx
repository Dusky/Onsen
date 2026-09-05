import { useState } from "react";
import type { ApplyStage, RegexScriptDto, ScriptScope } from "@shared/types.ts";
import { APPLY_STAGES, SCRIPT_SCOPES } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useCharacters,
  useCreateScript,
  useDeleteScript,
  useScenes,
  useTestScripts,
  useUpdateScript,
} from "../lib/queries.ts";

/**
 * A regex script, written and tried in one sheet (SPEC §14).
 *
 * The test panel is inside the editor rather than beside it because a pattern
 * is not something anyone gets right first time. §14 asks for a panel; putting
 * it anywhere else would mean saving a script to find out what it does, and a
 * saved script is one that has already run over a scene.
 */
export function ScriptEditor({
  script,
  onClose,
}: {
  script: RegexScriptDto | null;
  onClose(): void;
}) {
  const create = useCreateScript();
  const update = useUpdateScript();
  const remove = useDeleteScript();
  const test = useTestScripts();
  const characters = useCharacters();
  const scenes = useScenes();
  const [confirmNode, confirm] = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const [stage, setStage] = useState<ApplyStage>(script?.applyTo ?? "ai_output");
  const [scope, setScope] = useState<ScriptScope>(script?.scope ?? "global");
  const [pattern, setPattern] = useState(script?.pattern ?? "");
  const [replacement, setReplacement] = useState(script?.replacement ?? "");
  const [flags, setFlags] = useState(script?.flags ?? "g");
  const [sample, setSample] = useState("");

  const characterList = characters.data ?? [];
  const sceneList = scenes.data ?? [];

  return (
    <Sheet title={script === null ? strings.settings.addScript : script.name} onClose={onClose}>
      <form
        className="pt-[8px] pb-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const name = String(form.get("name") ?? "").trim();
          const characterId = String(form.get("characterId") ?? "");
          const sceneId = String(form.get("sceneId") ?? "");
          const done = { onSuccess: () => onClose(), onError: (e: Error) => setError(e.message) };

          if (script === null) {
            create.mutate(
              {
                name,
                pattern,
                replacement,
                flags,
                applyTo: stage,
                scope,
                ...(scope === "character" ? { characterId } : {}),
                ...(scope === "scene" ? { sceneId } : {}),
              } as Partial<RegexScriptDto>,
              done,
            );
          } else {
            // Scope is fixed after creation: it decides which of two columns
            // carries the subject, and the schema refuses a row with both.
            update.mutate({ id: script.id, name, pattern, replacement, flags, applyTo: stage }, done);
          }
        }}
      >
        <p className="section-label mb-[6px]">{strings.settings.scriptName}</p>
        <input name="name" className="field mb-[16px]" defaultValue={script?.name ?? ""} required />

        <p className="section-label mb-[6px]">{strings.settings.scriptStage}</p>
        <select
          className="field"
          value={stage}
          onChange={(event) => setStage(event.target.value as ApplyStage)}
        >
          {APPLY_STAGES.map((value) => (
            <option key={value} value={value}>
              {strings.settings.stageLabel[value]}
            </option>
          ))}
        </select>
        <p className="explain mt-[7px] mb-[16px]">
          {strings.settings.stageHint[stage]}
        </p>

        {script === null ? (
          <>
            <p className="section-label mb-[6px]">{strings.settings.scriptScope}</p>
            <select
              className="field mb-[10px]"
              value={scope}
              onChange={(event) => setScope(event.target.value as ScriptScope)}
            >
              {SCRIPT_SCOPES.map((value) => (
                <option key={value} value={value}>
                  {strings.settings.scopeLabel[value]}
                </option>
              ))}
            </select>
            {scope === "character" ? (
              <select name="characterId" className="field mb-[16px]" required>
                {characterList.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </select>
            ) : null}
            {scope === "scene" ? (
              <select name="sceneId" className="field mb-[16px]" required>
                {sceneList.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.title}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        ) : null}

        <p className="section-label mb-[6px]">{strings.settings.scriptPattern}</p>
        <input
          className="field font-mono text-[13px]"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          spellCheck={false}
          required
        />
        <p className="explain mt-[7px] mb-[16px]">
          {strings.settings.scriptPatternHint}
        </p>

        <p className="section-label mb-[6px]">{strings.settings.scriptReplacement}</p>
        <input
          className="field font-mono text-[13px]"
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
          spellCheck={false}
        />
        <p className="explain mt-[7px] mb-[16px]">
          {strings.settings.scriptReplacementHint}
        </p>

        <p className="section-label mb-[6px]">{strings.settings.scriptFlags}</p>
        <input
          className="field font-mono text-[13px]"
          value={flags}
          onChange={(event) => setFlags(event.target.value)}
          spellCheck={false}
        />
        <p className="explain mt-[7px] mb-[18px]">
          {strings.settings.scriptFlagsHint}
        </p>

        {error !== null ? (
          <p className="explain explain-alert mb-[12px]">{error}</p>
        ) : null}

        <button type="submit" className="btn btn-primary w-full">
          {strings.settings.save}
        </button>
        {script !== null ? (
          <button
            type="button"
            className="btn mt-[8px] w-full"
            onClick={() =>
              confirm(
                strings.settings.scriptDeleteConfirm,
                () => remove.mutate(script.id, { onSuccess: () => onClose() }),
                { confirmLabel: strings.settings.scriptDelete },
              )
            }
          >
            {strings.settings.scriptDelete}
          </button>
        ) : null}
      </form>

      {/* The panel. Deliberately below the save button: it is how you decide
          whether to press it. */}
      <div className="border-t border-rule pt-[14px] pb-[10px]">
        <p className="section-label mb-[4px]">{strings.settings.scriptTest}</p>
        <p className="explain mb-[10px]">
          {strings.settings.scriptTestHint}
        </p>
        <textarea
          className="field min-h-[72px]"
          value={sample}
          placeholder={strings.settings.scriptTestInput}
          onChange={(event) => setSample(event.target.value)}
        />
        <button
          type="button"
          className="btn mt-[10px] w-full"
          disabled={sample.trim() === "" || test.isPending}
          onClick={() =>
            test.mutate({
              applyTo: stage,
              text: sample,
              // The pattern in the form, not the one on disk. Trying it is how
              // you decide whether to save it.
              draft: { name: script?.name ?? "This script", pattern, replacement, flags },
              ...(scope === "scene" && script?.sceneId != null ? { sceneId: script.sceneId } : {}),
            })
          }
        >
          {strings.settings.scriptTestRun}
        </button>

        {test.data !== undefined ? (
          <div className="mt-[14px]">
            <p className="section-label mb-[6px]">{strings.settings.scriptTestAfter}</p>
            <p className="font-mono text-[12px] leading-[1.6] whitespace-pre-wrap">
              {test.data.after}
            </p>
            <div className="mt-[10px]">
              {test.data.runs.map((run) => (
                <p
                  key={run.scriptId}
                  className="chrome text-[11.5px] leading-[1.7] text-ink-dim"
                >
                  {run.name} ·{" "}
                  {run.error !== null
                    ? run.error
                    : run.replacements === 0
                      ? strings.settings.scriptTestNoChange
                      : strings.settings.scriptTestCount(run.replacements)}
                  {run.unknownMacros.length > 0
                    ? ` · ${strings.settings.scriptTestUnknown(run.unknownMacros.join(", "))}`
                    : ""}
                </p>
              ))}
            </div>
          </div>
        ) : null}
        {test.error !== null ? (
          <p className="explain explain-alert mt-[10px]">
            {test.error.message}
          </p>
        ) : null}
      </div>
      {confirmNode}
    </Sheet>
  );
}
