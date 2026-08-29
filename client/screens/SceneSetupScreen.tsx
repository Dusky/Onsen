import { useState } from "react";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import {
  useAddToCast,
  useAuthors,
  useCharacters,
  useConnectionProfiles,
  useCreatePersona,
  usePersonas,
  useRemoveFromCast,
  useScene,
  useSceneSetup,
  useTaskRuns,
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
        className="hairline flex flex-none items-baseline gap-[12px] px-[22px] pb-[12px]"
        style={{ paddingTop: "calc(18px + env(safe-area-inset-top))" }}
      >
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
