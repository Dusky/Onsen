import { useState } from "react";
import { strings } from "../strings.ts";
import { BanListSheet, OptionGroupSheet } from "../components/OptionSheets.tsx";
import { navigate } from "../lib/router.ts";
import {
  useAddBan,
  useAddToCast,
  useAnalyseBans,
  useAuthors,
  useBans,
  useCharacters,
  useConnectionProfiles,
  useCreatePersona,
  useDeleteBan,
  usePersonas,
  useRemoveFromCast,
  useResetOptions,
  useScene,
  useSceneOptions,
  useSceneSetup,
  useSetOption,
  useTaskRuns,
  useUpdateBan,
} from "../lib/queries.ts";
import { Sheet } from "../components/Sheet.tsx";
import { TURN_STRATEGIES, type TurnStrategy } from "@shared/types.ts";

/**
 * Scene setup: who is writing, who you are, and who is in it.
 *
 * The author picker is the first thing on the screen because it is the decision
 * that changes what the app is — with an author, one partner plays the whole
 * cast; without one, it is a single character in a system prompt.
 *
 * The model profile, lorebook and guide rows the design draws belong to phases
 * that have not happened yet, and are left out rather than stubbed.
 */

function labelFor(strategy: TurnStrategy): string {
  switch (strategy) {
    case "manual":
      return strings.sceneSetup.strategyManual;
    case "round_robin":
      return strings.sceneSetup.strategyRoundRobin;
    case "mention":
      return strings.sceneSetup.strategyMention;
    case "classifier":
      return strings.sceneSetup.strategyClassifier;
  }
}

/**
 * A bounded whole number. Committed on blur rather than per keystroke: every
 * one of these is a server round-trip, and a threshold typed as "2" on the way
 * to "20" is a setting that briefly means something very different.
 */
function NumberField({
  label,
  unit,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onCommit(value: number): void;
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className="section-label mb-[6px] block">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        defaultValue={value}
        key={value}
        className="field"
        onBlur={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (!Number.isInteger(next) || next < min || next > max) {
            event.target.value = String(value);
            return;
          }
          if (next !== value) onCommit(next);
        }}
      />
      <span className="chrome mt-[5px] block text-[9px] tracking-[0.10em] text-ink-dim uppercase">
        {unit}
      </span>
    </label>
  );
}

export function SceneSetupScreen({ sceneId }: { sceneId: string }) {
  const query = useScene(sceneId);
  const authors = useAuthors();
  const personas = usePersonas();
  const characters = useCharacters();
  const setup = useSceneSetup(sceneId);
  const addToCast = useAddToCast(sceneId);
  const removeFromCast = useRemoveFromCast(sceneId);
  const createPersona = useCreatePersona();
  const profiles = useConnectionProfiles();
  // What the turn director has actually been doing. A side call may never fail
  // a generation (SPEC §7), so its failures are swallowed on purpose — and a
  // swallowed failure nobody can read is the feature quietly not working.
  const directorRuns = useTaskRuns("turn_classifier", query.data?.scene.turnStrategy === "classifier");
  const [picking, setPicking] = useState(false);
  // Prompt options and the ban list (SPEC §13.5, §13.6).
  const options = useSceneOptions(sceneId);
  const setOption = useSetOption(sceneId);
  const resetOptions = useResetOptions(sceneId);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [bansOpen, setBansOpen] = useState(false);
  // Only fetched with the sheet open: the list is long and nothing on the
  // setup screen needs it until then, beyond the count on its row.
  const bans = useBans(sceneId, true);
  const addBan = useAddBan(sceneId);
  const analyseBans = useAnalyseBans(sceneId);
  const updateBan = useUpdateBan(sceneId);
  const deleteBan = useDeleteBan(sceneId);

  const scene = query.data?.scene;
  if (scene === undefined) {
    return (
      <div className="flex screen-height items-center justify-center">
        <p className="chrome text-[9px] tracking-[0.18em] text-ink-dim uppercase">
          {strings.common.working}
        </p>
      </div>
    );
  }

  const inCast = new Set(scene.cast.map((member) => member.characterId));
  const available = (characters.data ?? []).filter((character) => !inCast.has(character.id));

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header hairline flex-none px-[22px] pb-[12px]"
        style={{ paddingTop: "calc(18px + env(safe-area-inset-top))" }}
      >
        {/* Wrapped so the whole row is capped to the column below it, rather
            than each of its parts being capped on its own. */}
        <div className="flex w-full items-baseline gap-[12px]">
          <button
            type="button"
            onClick={() => navigate({ name: "chat", sceneId })}
            aria-label={strings.common.back}
            className="chrome -ml-[6px] flex h-[34px] w-[24px] items-center text-[18px] text-ink-muted"
          >
            {strings.chat.back}
          </button>
          <div className="min-w-0 flex-1">
            <p className="screen-kicker">{strings.sceneSetup.kicker}</p>
            <h1 className="truncate text-[19px] font-medium tracking-[-0.01em]">{scene.title}</h1>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[16px]">
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
          <p className="section-label mb-[8px]">{strings.sceneSetup.title_}</p>
          <input
            className="field mb-[22px]"
            defaultValue={scene.title}
            onBlur={(event) => {
              const title = event.target.value.trim();
              if (title !== "" && title !== scene.title) setup.mutate({ title });
            }}
          />

          {/* The author decides what the app is for this roleplay. */}
          <p className="section-label mb-[8px]">{strings.sceneSetup.author}</p>
          <div className="mb-[8px] flex flex-wrap gap-[6px]">
            <button
              type="button"
              onClick={() => setup.mutate({ authorId: null })}
              className={`btn ${scene.authorId === null ? "btn-primary" : ""}`}
            >
              {strings.sceneSetup.authorNone}
            </button>
            {(authors.data ?? []).map((author) => (
              <button
                key={author.id}
                type="button"
                onClick={() => setup.mutate({ authorId: author.id })}
                className={`btn ${scene.authorId === author.id ? "btn-primary" : ""}`}
              >
                {author.name}
              </button>
            ))}
          </div>
          <p className="chrome mb-[22px] text-[9.5px] leading-[1.5] text-ink-dim">
            {strings.sceneSetup.authorHint}
          </p>

          <p className="section-label mb-[8px]">{strings.sceneSetup.persona}</p>
          <div className="mb-[22px] flex flex-wrap gap-[6px]">
            {(personas.data ?? []).map((persona) => (
              <button
                key={persona.id}
                type="button"
                onClick={() => setup.mutate({ personaId: persona.id })}
                className={`btn ${scene.personaId === persona.id ? "btn-primary" : ""}`}
              >
                {persona.name}
              </button>
            ))}
            {(personas.data ?? []).length === 0 ? (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  createPersona.mutate(
                    {},
                    { onSuccess: (persona) => setup.mutate({ personaId: persona.id }) },
                  )
                }
              >
                {strings.sceneSetup.personaNone}
              </button>
            ) : null}
          </div>

          <p className="section-label mb-[8px]">{strings.sceneSetup.turnStrategy}</p>
          <div className="mb-[8px] flex flex-wrap gap-[6px]">
            {TURN_STRATEGIES.map((strategy) => (
              <button
                key={strategy}
                type="button"
                onClick={() => setup.mutate({ turnStrategy: strategy })}
                className={`btn ${scene.turnStrategy === strategy ? "btn-primary" : ""}`}
              >
                {labelFor(strategy)}
              </button>
            ))}
          </div>
          {/* `mention` is accepted by the schema but not yet built; the director
              falls back to round robin and says so rather than silently doing
              something else. */}
          {scene.turnStrategy === "mention" ? (
            <p className="chrome mb-[22px] text-[9.5px] leading-[1.5] text-ink-dim">
              {strings.sceneSetup.strategyNotReady}
            </p>
          ) : scene.turnStrategy === "classifier" ? (
            <p className="chrome mb-[16px] text-[9.5px] leading-[1.5] text-ink-dim">
              {strings.sceneSetup.strategyClassifierHint}
            </p>
          ) : (
            <div className="mb-[22px]" />
          )}

          {/* The classifier is a one-line question, so it wants a small model —
              which is the whole reason it can be routed separately (SPEC §6). */}
          {scene.turnStrategy === "classifier" ? (
            <>
              <p className="section-label mb-[8px]">{strings.sceneSetup.directorProfile}</p>
              <div className="mb-[8px] flex flex-wrap gap-[6px]">
                <button
                  type="button"
                  onClick={() => setup.mutate({ directorProfileId: null })}
                  className={`btn ${scene.directorProfileId === null ? "btn-primary" : ""}`}
                >
                  {strings.sceneSetup.directorProfileSame}
                </button>
                {(profiles.data ?? []).map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setup.mutate({ directorProfileId: profile.id })}
                    className={`btn ${scene.directorProfileId === profile.id ? "btn-primary" : ""}`}
                  >
                    {profile.name}
                  </button>
                ))}
              </div>
              <p className="chrome mb-[16px] text-[9.5px] leading-[1.5] text-ink-dim">
                {strings.sceneSetup.directorProfileHint}
              </p>

              <p className="section-label mb-[8px]">{strings.sceneSetup.directorRuns}</p>
              {(() => {
                const runs = (directorRuns.data ?? [])
                  .filter((run) => run.sceneId === sceneId)
                  .slice(0, 5);
                if (runs.length === 0) {
                  return (
                    <p className="chrome mb-[22px] text-[10px] tracking-[0.12em] text-ink-dim uppercase">
                      {strings.sceneSetup.directorRunsEmpty}
                    </p>
                  );
                }
                return (
                  <div className="mb-[22px]">
                    {runs.map((run) => (
                      <div key={run.id} className="border-b border-rule py-[9px]">
                        <div className="flex items-baseline gap-[8px]">
                          <span
                            className="chrome text-[9px] tracking-[0.12em] uppercase"
                            style={{
                              color:
                                run.status === "ok"
                                  ? "var(--onsen-color-text-label)"
                                  : "var(--onsen-color-red)",
                            }}
                          >
                            {strings.sceneSetup.directorRunStatus(run.status)}
                          </span>
                          <span className="chrome flex-1 truncate text-[9px] tracking-[0.06em] text-ink-dim">
                            {run.model ?? ""}
                          </span>
                          <span className="chrome text-[9px] tracking-[0.06em] text-ink-dim">
                            {strings.sceneSetup.directorRunTiming(run.durationMs)}
                          </span>
                        </div>
                        {/* The answer when it worked, the reason when it did not. */}
                        {run.status === "ok" ? null : run.detail === null ? null : (
                          <p className="chrome mt-[4px] text-[9px] leading-[1.5] text-ink-dim">
                            {run.detail}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          ) : null}

          {/* SPEC §7.5: auto-run per scene, or manual per message. Which passes
              take part is the per-op switch, in Settings. */}
          <p className="section-label mb-[8px]">{strings.sceneSetup.autoPasses}</p>
          <div className="mb-[8px] flex gap-[6px]">
            {[false, true].map((on) => (
              <button
                key={String(on)}
                type="button"
                onClick={() => setup.mutate({ autoPasses: on })}
                className={`btn flex-1 ${scene.autoPasses === on ? "btn-primary" : ""}`}
              >
                {on ? strings.sceneSetup.autoPassesOn : strings.sceneSetup.autoPassesOff}
              </button>
            ))}
          </div>
          <p className="chrome mb-[22px] text-[9.5px] leading-[1.5] text-ink-dim">
            {strings.sceneSetup.autoPassesHint}
          </p>

          {/* The scene's own framing (SPEC §2). */}
          <p className="section-label mb-[8px]">{strings.sceneSetup.scenario}</p>
          <textarea
            rows={3}
            className="field mb-[8px] resize-none py-[10px]"
            placeholder={strings.sceneSetup.scenarioPlaceholder}
            defaultValue={scene.scenarioOverride ?? ""}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value === (scene.scenarioOverride ?? "")) return;
              setup.mutate({ scenarioOverride: value === "" ? null : value });
            }}
          />
          <p className="chrome mb-[22px] text-[9.5px] leading-[1.5] text-ink-dim">
            {strings.sceneSetup.scenarioHint}
          </p>

          {/* Prompt option groups (SPEC §13.5). One row per group showing what
              is chosen; the options themselves are a sheet, because seven
              groups of four to six is thirty-odd switches on one screen. */}
          <div className="mb-[8px] flex items-baseline justify-between gap-[10px]">
            <p className="section-label">{strings.sceneSetup.options}</p>
            <p className="chrome text-[9px] tracking-[0.08em] text-ink-dim uppercase">
              {options.data === undefined
                ? ""
                : strings.sceneSetup.optionsCost(options.data.tokenCount)}
            </p>
          </div>
          <p className="chrome mb-[10px] text-[9.5px] leading-[1.5] text-ink-dim">
            {strings.sceneSetup.optionsHint}
          </p>
          {(options.data?.groups ?? []).map((group) => {
            const chosen = group.options.filter((option) => option.selected);
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => setEditingGroup(group.id)}
                className="flex w-full items-baseline gap-[9px] border-b border-rule py-[12px] text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="chrome block text-[9.5px] tracking-[0.1em] text-ink-muted uppercase">
                    {group.name}
                  </span>
                  <span className="mt-[4px] block truncate text-[13.5px]">
                    {chosen.length === 0
                      ? strings.sceneSetup.optionsNone
                      : chosen.map((option) => option.name).join(" · ")}
                  </span>
                </span>
                <span className="chrome flex-none text-[9px] tracking-[0.08em] text-ink-dim uppercase">
                  {chosen.reduce((sum, option) => sum + option.tokenCount, 0)} TOK
                </span>
              </button>
            );
          })}

          {/* The ban list is its own sheet: it has proposals to judge, two
              scopes, and a list that grows (SPEC §13.6). */}
          <button
            type="button"
            onClick={() => setBansOpen(true)}
            className="flex w-full items-baseline gap-[9px] border-b border-rule py-[12px] text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="chrome block text-[9.5px] tracking-[0.1em] text-ink-muted uppercase">
                {strings.sceneSetup.bans}
              </span>
              <span className="mt-[4px] block truncate text-[13.5px]">
                {bans.data === undefined
                  ? "—"
                  : strings.sceneSetup.bansCount(
                      bans.data.phrases.filter(
                        (row) => row.enabled && row.origin !== "proposed",
                      ).length,
                      bans.data.phrases.filter((row) => row.origin === "proposed").length,
                    )}
              </span>
            </span>
            <span className="chrome flex-none text-[9px] tracking-[0.08em] text-ink-dim uppercase">
              {bans.data === undefined ? "" : `${bans.data.tokenCount} TOK`}
            </span>
          </button>

          {/* Only offered once the scene has chosen for itself: a scene still
              running on the shipped configuration has nothing to go back to. */}
          {options.data?.configured === true ? (
            <button
              type="button"
              className="btn mt-[12px] w-full"
              onClick={() => {
                if (!window.confirm(strings.sceneSetup.optionsResetConfirm)) return;
                resetOptions.mutate(undefined);
              }}
            >
              {strings.sceneSetup.optionsReset}
            </button>
          ) : (
            <p className="chrome mt-[10px] text-[9px] tracking-[0.08em] text-ink-dim uppercase">
              {strings.sceneSetup.optionsDefaults}
            </p>
          )}
          <div className="mb-[22px]" />

          {/* Rolling summarisation (SPEC §11 layer 1). Every knob is per scene
              because how fast a story moves is a property of the story. */}
          <p className="section-label mb-[8px]">{strings.sceneSetup.summarise}</p>
          <div className="mb-[8px] flex gap-[6px]">
            {[true, false].map((on) => (
              <button
                key={String(on)}
                type="button"
                onClick={() => setup.mutate({ summarise: on })}
                className={`btn flex-1 ${scene.summarise === on ? "btn-primary" : ""}`}
              >
                {on ? strings.sceneSetup.summariseOn : strings.sceneSetup.summariseOff}
              </button>
            ))}
          </div>
          <p className="chrome mb-[18px] text-[9.5px] leading-[1.5] text-ink-dim">
            {strings.sceneSetup.summariseHint}
          </p>

          {scene.summarise ? (
            <>
              <div className="mb-[8px] flex gap-[10px]">
                <NumberField
                  label={strings.sceneSetup.summariseEveryMessages}
                  unit={strings.sceneSetup.summariseEveryMessagesUnit}
                  value={scene.summariseEveryMessages}
                  min={2}
                  max={500}
                  onCommit={(value) => setup.mutate({ summariseEveryMessages: value })}
                />
                <NumberField
                  label={strings.sceneSetup.summariseEveryWords}
                  unit={strings.sceneSetup.summariseEveryWordsUnit}
                  value={scene.summariseEveryWords}
                  min={100}
                  max={100000}
                  onCommit={(value) => setup.mutate({ summariseEveryWords: value })}
                />
              </div>
              <p className="chrome mb-[18px] text-[9.5px] leading-[1.5] text-ink-dim">
                {strings.sceneSetup.summariseEveryHint}
              </p>

              <div className="mb-[8px] flex gap-[10px]">
                <NumberField
                  label={strings.sceneSetup.summariseThreshold}
                  unit={strings.sceneSetup.summariseThresholdUnit}
                  value={scene.summariseThreshold}
                  min={0}
                  max={500}
                  onCommit={(value) => setup.mutate({ summariseThreshold: value })}
                />
                <NumberField
                  label={strings.sceneSetup.summariseFreeze}
                  unit={strings.sceneSetup.summariseFreezeUnit}
                  value={scene.summariseFreeze}
                  min={1}
                  max={100}
                  onCommit={(value) => setup.mutate({ summariseFreeze: value })}
                />
              </div>
              <p className="chrome mb-[6px] text-[9.5px] leading-[1.5] text-ink-dim">
                {strings.sceneSetup.summariseThresholdHint}
              </p>
              <p className="chrome mb-[18px] text-[9.5px] leading-[1.5] text-ink-dim">
                {strings.sceneSetup.summariseFreezeHint}
              </p>

              <p className="section-label mb-[8px]">{strings.sceneSetup.summariseEvict}</p>
              <div className="mb-[8px] flex gap-[6px]">
                {[false, true].map((on) => (
                  <button
                    key={String(on)}
                    type="button"
                    onClick={() => setup.mutate({ summariseEvict: on })}
                    className={`btn flex-1 ${scene.summariseEvict === on ? "btn-primary" : ""}`}
                  >
                    {on ? strings.sceneSetup.summariseEvictOn : strings.sceneSetup.summariseEvictOff}
                  </button>
                ))}
              </div>
              <p className="chrome mb-[22px] text-[9.5px] leading-[1.5] text-ink-dim">
                {strings.sceneSetup.summariseEvictHint}
              </p>
            </>
          ) : null}

          {/* SPEC §8's sixth guide. It is the only one with nothing built in to
              ask, so its question is scene configuration and lives here; the
              other five are switched on per op in Settings. */}
          <p className="section-label mb-[8px]">{strings.sceneSetup.customGuide}</p>
          <textarea
            rows={2}
            className="field mb-[8px] resize-none py-[10px]"
            placeholder={strings.sceneSetup.customGuidePlaceholder}
            defaultValue={scene.customGuidePrompt ?? ""}
            onBlur={(event) => {
              const prompt = event.target.value.trim();
              if (prompt === (scene.customGuidePrompt ?? "")) return;
              setup.mutate({ customGuidePrompt: prompt === "" ? null : prompt });
            }}
          />
          <p className="chrome mb-[22px] text-[9.5px] leading-[1.5] text-ink-dim">
            {strings.sceneSetup.customGuideHint}
          </p>

          <p className="section-label mb-[8px]">{strings.sceneSetup.cast}</p>
          {scene.cast.length === 0 ? (
            <p className="chrome mb-[10px] text-[10px] tracking-[0.12em] text-ink-dim uppercase">
              {strings.sceneSetup.castEmpty}
            </p>
          ) : null}

          <div className="mb-[12px] flex flex-wrap gap-[10px]">
            {scene.cast.map((member) => (
              <div key={member.characterId} className="w-[68px]">
                <div
                  className="h-[74px] w-full border border-rule bg-cover bg-center"
                  style={
                    member.hasAvatar
                      ? { backgroundImage: `url(/api/characters/${member.characterId}/avatar)` }
                      : { background: "var(--onsen-stripe)" }
                  }
                />
                <p className="chrome mt-[5px] truncate text-[9px] tracking-[0.08em] text-ink-label uppercase">
                  {member.name}
                </p>
                <button
                  type="button"
                  className="chrome mt-[2px] text-[8.5px] tracking-[0.1em] uppercase"
                  style={{ color: "var(--onsen-color-red)" }}
                  onClick={() => removeFromCast.mutate(member.characterId)}
                >
                  {strings.sceneSetup.remove}
                </button>
              </div>
            ))}
          </div>

          <button type="button" className="btn mb-[24px] w-full" onClick={() => setPicking(true)}>
            {strings.sceneSetup.addToCast}
          </button>
        </div>
      </main>

      <footer
        className="flex-none border-t border-rule bg-bg-raised px-[22px] pt-[12px]"
        style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          className="btn btn-primary mx-auto block w-full max-w-[var(--onsen-prose-measure)]"
          onClick={() => navigate({ name: "chat", sceneId })}
        >
          {strings.sceneSetup.done}
        </button>
      </footer>

      {editingGroup !== null ? (
        (() => {
          const group = (options.data?.groups ?? []).find((row) => row.id === editingGroup);
          return group === undefined ? null : (
            <OptionGroupSheet
              group={group}
              onSet={(optionId, on) => setOption.mutate({ optionId, on })}
              onClose={() => setEditingGroup(null)}
            />
          );
        })()
      ) : null}

      {bansOpen ? (
        <BanListSheet
          state={bans.data}
          analysing={analyseBans.isPending}
          detail={
            (analyseBans.data as { detail?: string | null } | undefined)?.detail ?? null
          }
          onAdd={(phrase, scoped) => addBan.mutate({ phrase, scoped })}
          onAnalyse={() => analyseBans.mutate(undefined)}
          onUpdate={(banId, patch) => updateBan.mutate({ banId, ...patch })}
          onDelete={(banId) => deleteBan.mutate(banId)}
          onClose={() => setBansOpen(false)}
        />
      ) : null}

      {picking ? (
        <Sheet title={strings.sceneSetup.addToCast} onClose={() => setPicking(false)}>
          {available.length === 0 ? (
            <p className="chrome py-[14px] text-[10px] tracking-[0.12em] text-ink-dim uppercase">
              {strings.characters.empty}
            </p>
          ) : null}
          {available.map((character) => (
            <button
              key={character.id}
              type="button"
              onClick={() => {
                addToCast.mutate(character.id);
                setPicking(false);
              }}
              className="flex w-full items-center gap-[12px] border-b border-rule py-[12px] text-left"
            >
              <span
                className="h-[44px] w-[34px] flex-none border border-rule bg-cover bg-center"
                style={
                  character.hasAvatar
                    ? { backgroundImage: `url(/api/characters/${character.id}/avatar)` }
                    : { background: "var(--onsen-stripe)" }
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{character.name}</span>
                <span className="chrome block text-[8.5px] tracking-[0.06em] text-ink-dim uppercase">
                  {strings.characters.tokens(character.tokens.total)}
                </span>
              </span>
            </button>
          ))}
        </Sheet>
      ) : null}
    </div>
  );
}
