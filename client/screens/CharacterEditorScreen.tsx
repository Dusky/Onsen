import { useEffect, useState, type ReactNode } from "react";
import type { CharacterDto, UpdateCharacterRequest } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import { useCharacter, useDeleteCharacter, useUpdateCharacter } from "../lib/queries.ts";

/**
 * The character editor.
 *
 * Every field carries its token cost on its own label row, and the footer prints
 * the card total as a share of the context window — the design's rule that cost
 * is never an abstract number. Seeing that a description costs four percent of
 * the window is the thing that makes a user shorten it.
 *
 * Fields are saved on blur rather than behind a save button: the card is a
 * document being edited, not a form being submitted, and a lost edit because
 * someone navigated away is the worse failure.
 */

const CONTEXT_WINDOW = 32_768;

type Tab = "card" | "greetings" | "advanced";

/** A label row with the field's cost printed at its end. */
function FieldRow({
  label,
  tokens,
  hint,
  children,
}: {
  label: string;
  tokens?: number;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-[18px]">
      <div className="mb-[8px] flex items-baseline justify-between gap-[10px]">
        <span className="section-label">{label}</span>
        {tokens === undefined ? null : (
          <span className="chrome text-[8.5px] text-ink-dim">
            {strings.characters.tokens(tokens)}
          </span>
        )}
      </div>
      {children}
      {hint === undefined ? null : (
        <p className="chrome mt-[7px] text-[9.5px] leading-[1.5] text-ink-dim">{hint}</p>
      )}
    </div>
  );
}

/** A text field that commits on blur and keeps its own draft while focused. */
function TextField({
  value,
  onCommit,
  rows = 1,
  placeholder,
}: {
  value: string;
  onCommit(next: string): void;
  rows?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  // Adopt a change that came from elsewhere — a save landing, or a refetch —
  // without stamping on what is currently being typed.
  useEffect(() => setDraft(value), [value]);

  return rows > 1 ? (
    <textarea
      className="field resize-y"
      style={{ minHeight: `${rows * 26 + 20}px` }}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  ) : (
    <input
      className="field"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}

/** A list of greetings: alternates and group-only openings both use this. */
function GreetingList({
  items,
  onChange,
}: {
  items: string[];
  onChange(next: string[]): void;
}) {
  return (
    <>
      {items.map((greeting, index) => (
        <div key={index} className="mb-[10px]">
          <TextField
            value={greeting}
            rows={3}
            onCommit={(next) => {
              const copy = [...items];
              copy[index] = next;
              onChange(copy);
            }}
          />
          <button
            type="button"
            className="chrome mt-[6px] text-[9px] tracking-[0.12em] uppercase"
            style={{ color: "var(--onsen-color-red)" }}
            onClick={() => onChange(items.filter((_, at) => at !== index))}
          >
            {strings.characters.removeGreeting}
          </button>
        </div>
      ))}
      <button type="button" className="btn w-full" onClick={() => onChange([...items, ""])}>
        {strings.characters.addGreeting}
      </button>
    </>
  );
}

export function CharacterEditorScreen({ characterId }: { characterId: string }) {
  const query = useCharacter(characterId);
  const update = useUpdateCharacter(characterId);
  const remove = useDeleteCharacter();
  const [tab, setTab] = useState<Tab>("card");

  const character: CharacterDto | undefined = query.data;
  if (character === undefined) {
    return (
      <div className="flex screen-height items-center justify-center">
        <p className="chrome text-[9px] tracking-[0.18em] text-ink-dim uppercase">
          {strings.common.working}
        </p>
      </div>
    );
  }

  const save = (patch: UpdateCharacterRequest) => update.mutate(patch);
  const tokens = character.tokens;

  const tabs: { key: Tab; label: string }[] = [
    { key: "card", label: strings.characters.tabCard },
    { key: "greetings", label: strings.characters.tabGreetings },
    { key: "advanced", label: strings.characters.tabAdvanced },
  ];

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="flex-none px-[22px] pb-[10px]"
        style={{ paddingTop: "calc(18px + env(safe-area-inset-top))" }}
      >
        <div className="flex items-baseline gap-[12px]">
          <button
            type="button"
            onClick={() => navigate({ name: "characters" })}
            aria-label={strings.common.back}
            className="chrome -ml-[6px] flex h-[34px] w-[24px] items-center text-[18px] text-ink-muted"
          >
            {strings.chat.back}
          </button>
          <div className="min-w-0 flex-1">
            <p className="screen-kicker">{strings.characters.editorKicker}</p>
            <h1 className="truncate text-[19px] font-medium tracking-[-0.01em]">
              {character.name}
            </h1>
          </div>
        </div>

        {/* Tab row: the active tab takes a 2px red underline. */}
        <div className="mt-[12px] flex gap-[18px] border-b border-rule">
          {tabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className="chrome -mb-px pb-[9px] text-[9.5px] tracking-[0.12em] uppercase"
              style={{
                color:
                  tab === entry.key
                    ? "var(--onsen-color-text-label)"
                    : "var(--onsen-color-text-muted)",
                borderBottom:
                  tab === entry.key ? "2px solid var(--onsen-color-red)" : "2px solid transparent",
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[16px]">
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
          {tab === "card" ? (
            <>
              <div className="mb-[18px] flex gap-[14px]">
                <div
                  className="h-[118px] w-[88px] flex-none border border-rule bg-cover bg-center"
                  style={
                    character.hasAvatar
                      ? { backgroundImage: `url(/api/characters/${character.id}/avatar)` }
                      : { background: "var(--onsen-stripe)" }
                  }
                />
                <div className="min-w-0 flex-1">
                  <FieldRow label={strings.characters.name}>
                    <TextField value={character.name} onCommit={(name) => save({ name })} />
                  </FieldRow>
                </div>
              </div>

              <FieldRow label={strings.characters.description} tokens={tokens.description}>
                <TextField
                  value={character.description ?? ""}
                  rows={5}
                  onCommit={(description) => save({ description: description || null })}
                />
              </FieldRow>

              <FieldRow label={strings.characters.personality} tokens={tokens.personality}>
                <TextField
                  value={character.personality ?? ""}
                  rows={3}
                  onCommit={(personality) => save({ personality: personality || null })}
                />
              </FieldRow>

              <FieldRow
                label={strings.characters.speech}
                tokens={tokens.voiceNotes}
                hint={strings.characters.speechHint}
              >
                <TextField
                  value={character.voiceNotes ?? ""}
                  rows={3}
                  onCommit={(voiceNotes) => save({ voiceNotes: voiceNotes || null })}
                />
              </FieldRow>

              <FieldRow label={strings.characters.scenario} tokens={tokens.scenario}>
                <TextField
                  value={character.scenario ?? ""}
                  rows={3}
                  onCommit={(scenario) => save({ scenario: scenario || null })}
                />
              </FieldRow>

              <FieldRow label={strings.characters.exampleDialogue} tokens={tokens.exampleDialogue}>
                <TextField
                  value={character.exampleDialogue ?? ""}
                  rows={5}
                  onCommit={(exampleDialogue) =>
                    save({ exampleDialogue: exampleDialogue || null })
                  }
                />
              </FieldRow>
            </>
          ) : null}

          {tab === "greetings" ? (
            <>
              <FieldRow label={strings.characters.firstMessage} tokens={tokens.firstMessage}>
                <TextField
                  value={character.firstMessage ?? ""}
                  rows={5}
                  onCommit={(firstMessage) => save({ firstMessage: firstMessage || null })}
                />
              </FieldRow>

              <FieldRow label={strings.characters.alternateGreetings}>
                <GreetingList
                  items={character.alternateGreetings}
                  onChange={(alternateGreetings) => save({ alternateGreetings })}
                />
              </FieldRow>

              <FieldRow
                label={strings.characters.groupGreetings}
                hint={strings.characters.groupGreetingsHint}
              >
                <GreetingList
                  items={character.groupGreetings}
                  onChange={(groupGreetings) => save({ groupGreetings })}
                />
              </FieldRow>
            </>
          ) : null}

          {tab === "advanced" ? (
            <>
              <FieldRow
                label={strings.characters.depthPrompt}
                tokens={tokens.depthPrompt}
                hint={strings.characters.depthPromptHint}
              >
                <TextField
                  value={character.depthPrompt ?? ""}
                  rows={3}
                  onCommit={(depthPrompt) => save({ depthPrompt: depthPrompt || null })}
                />
              </FieldRow>

              <FieldRow label={strings.characters.depth}>
                <input
                  className="field"
                  type="number"
                  value={character.depthPromptDepth}
                  onChange={(event) =>
                    save({ depthPromptDepth: Number(event.target.value) || 0 })
                  }
                />
              </FieldRow>

              <FieldRow label={strings.characters.systemPrompt}>
                <TextField
                  value={character.systemPrompt ?? ""}
                  rows={3}
                  onCommit={(systemPrompt) => save({ systemPrompt: systemPrompt || null })}
                />
              </FieldRow>

              <FieldRow label={strings.characters.postHistory}>
                <TextField
                  value={character.postHistoryInstructions ?? ""}
                  rows={3}
                  onCommit={(postHistoryInstructions) =>
                    save({ postHistoryInstructions: postHistoryInstructions || null })
                  }
                />
              </FieldRow>

              <FieldRow label={strings.characters.creatorNotes}>
                <TextField
                  value={character.creatorNotes ?? ""}
                  rows={3}
                  onCommit={(creatorNotes) => save({ creatorNotes: creatorNotes || null })}
                />
              </FieldRow>

              {/* What the original card carried that this editor does not show.
                  It survives export; saying so is what stops it feeling lost. */}
              {character.unmodelledFields.length > 0 ? (
                <div className="mb-[18px] border border-rule px-[11px] py-[10px]">
                  <p className="section-label">{strings.characters.preserved}</p>
                  <p className="chrome mt-[6px] text-[9px] leading-[1.6] text-ink-dim">
                    {character.unmodelledFields.join(", ")}
                  </p>
                </div>
              ) : null}

              <p className="chrome mb-[18px] text-[9px] tracking-[0.08em] text-ink-dim uppercase">
                {strings.characters.format(character.format)}
              </p>

              <p className="section-label mb-[8px]">{strings.characters.exportAs}</p>
              <div className="mb-[24px] flex gap-[8px]">
                {(
                  [
                    ["png", strings.characters.exportPng],
                    ["charx", strings.characters.exportCharx],
                    ["json", strings.characters.exportJson],
                  ] as const
                ).map(([format, label]) => (
                  <a
                    key={format}
                    href={`/api/characters/${character.id}/export?format=${format}`}
                    className="btn flex flex-1 items-center justify-center no-underline"
                  >
                    {label}
                  </a>
                ))}
              </div>

              <button
                type="button"
                className="btn w-full"
                style={{ color: "var(--onsen-color-red)", borderColor: "var(--onsen-color-red-border)" }}
                onClick={() => {
                  if (!window.confirm(strings.characters.deleteConfirm(character.name))) return;
                  remove.mutate(character.id, {
                    onSuccess: () => navigate({ name: "characters" }),
                  });
                }}
              >
                {strings.characters.deleteCharacter}
              </button>
            </>
          ) : null}
        </div>
      </main>

      {/* The standing cost rail. Cost is a share of the window, never an
          abstract number (design handoff). */}
      <footer
        className="flex-none border-t border-rule bg-bg-raised px-[22px] pt-[11px] pb-[12px]"
        style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
          <div className="flex items-baseline justify-between">
            <span className="section-label">{strings.characters.cardTotal}</span>
            <span className="chrome text-[9px] tracking-[0.06em] text-ink-label uppercase">
              {strings.characters.shareOfContext(tokens.total, CONTEXT_WINDOW)}
            </span>
          </div>
          <div className="mt-[8px] h-[4px] w-full bg-rule">
            <div
              className="h-full"
              style={{
                width: `${Math.min(100, (tokens.total / CONTEXT_WINDOW) * 100)}%`,
                background: "var(--onsen-color-red)",
              }}
            />
          </div>
        </div>
      </footer>
    </div>
  );
}
