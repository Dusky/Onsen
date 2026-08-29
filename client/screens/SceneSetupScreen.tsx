import { useState } from "react";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import {
  useAddToCast,
  useAuthors,
  useCharacters,
  useCreatePersona,
  usePersonas,
  useRemoveFromCast,
  useScene,
  useSceneSetup,
} from "../lib/queries.ts";
import { Sheet } from "../components/Sheet.tsx";

/**
 * Scene setup: who is writing, who you are, and who is in it.
 *
 * The author picker is the first thing on the screen because it is the decision
 * that changes what the app is — with an author, one partner plays the whole
 * cast; without one, it is a single character in a system prompt.
 *
 * The model profile, turn strategy, lorebooks and guides rows the design draws
 * belong to phases that have not happened yet, and are left out rather than
 * stubbed.
 */

export function SceneSetupScreen({ sceneId }: { sceneId: string }) {
  const query = useScene(sceneId);
  const authors = useAuthors();
  const personas = usePersonas();
  const characters = useCharacters();
  const setup = useSceneSetup(sceneId);
  const addToCast = useAddToCast(sceneId);
  const removeFromCast = useRemoveFromCast(sceneId);
  const createPersona = useCreatePersona();
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
