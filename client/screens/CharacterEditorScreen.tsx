import { useEffect, useState, type ReactNode } from "react";
import type { CharacterDto, UpdateCharacterRequest } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { navigate } from "../lib/router.ts";
import {
  useCharacter,
  useCharacterVersions,
  useDeleteCharacter,
  useRestoreVersion,
  useSuggestTags,
  useUpdateCharacter,
  useAuthorRevise,
  useAuthorVoice,
  useExpressionPack,
  useUploadExpression,
  useDeleteExpression,
} from "../lib/queries.ts";
import { Sheet, SheetAction } from "../components/Sheet.tsx";

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

type Tab = "card" | "greetings" | "sprites" | "advanced";

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
/**
 * "doc, the captain, cap" -> ["doc", "the captain", "cap"], deduped
 * case-insensitively. Blanks fall out, so a trailing comma is not a keyword
 * that matches everything.
 */
function splitKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "" || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    keywords.push(trimmed);
  }
  return keywords;
}

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
  const versions = useCharacterVersions(characterId);
  const restore = useRestoreVersion(characterId);
  const suggest = useSuggestTags(characterId);
  const authorRevise = useAuthorRevise(characterId);
  const authorVoice = useAuthorVoice(characterId);
  const sprites = useExpressionPack(characterId);
  const uploadSprite = useUploadExpression(characterId);
  const removeSprite = useDeleteExpression(characterId);
  const [tab, setTab] = useState<Tab>("card");
  const [tagDraft, setTagDraft] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [spriteLabel, setSpriteLabel] = useState("");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseDraft, setReviseDraft] = useState("");
  const [confirmNode, confirm] = useConfirm();

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
    { key: "sprites", label: strings.characters.tabSprites },
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

              {/* SPEC §6: what the `mention` director listens for besides the
                  name. Comma separated because these are short — "doc", "the
                  captain" — and a list editor for two words is a list editor
                  too many. */}
              <FieldRow
                label={strings.characters.mentionKeywords}
                hint={strings.characters.mentionKeywordsHint}
              >
                <TextField
                  value={character.mentionKeywords.join(", ")}
                  onCommit={(raw) => save({ mentionKeywords: splitKeywords(raw) })}
                />
              </FieldRow>

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

          {tab === "sprites" ? (
            <>
              {/* Sprites (SPEC §12, DESIGN §295): a labelled image per expression,
                  which the VN stage draws when the author declares that label. */}
              <p className="section-label mb-[8px]">{strings.characters.sprites}</p>
              <p className="chrome mb-[8px] text-[9px] leading-[1.5] text-ink-dim">
                {strings.characters.spritesHint}
              </p>
              <div className="mb-[8px] flex flex-wrap gap-[6px]">
                {(sprites.data?.expressions ?? []).map((expression) => (
                  <button
                    key={expression.id}
                    type="button"
                    onClick={() => removeSprite.mutate(expression.id)}
                    className="chrome border px-[10px] py-[6px] text-[9px] tracking-[0.08em] uppercase"
                    style={{ borderColor: "var(--onsen-color-border-quiet)", color: "var(--onsen-color-text-muted)" }}
                  >
                    {expression.label} ×
                  </button>
                ))}
              </div>
              {/* The label is typed in the field, not a native prompt: a
                  mobile-first app cannot lean on window.prompt. */}
              <div className="mb-[8px] flex gap-[6px]">
                <input
                  className="field flex-1"
                  placeholder={strings.characters.spriteLabelPrompt}
                  value={spriteLabel}
                  onChange={(event) => setSpriteLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const label = spriteLabel.trim().toLowerCase();
                    if (label === "") return;
                    setSpriteLabel(label);
                    document.getElementById(`sprite-${characterId}`)?.click();
                  }}
                />
                <button
                  type="button"
                  className="btn flex-none"
                  disabled={uploadSprite.isPending || spriteLabel.trim() === ""}
                  onClick={() => {
                    setSpriteLabel(spriteLabel.trim().toLowerCase());
                    document.getElementById(`sprite-${characterId}`)?.click();
                  }}
                >
                  {strings.characters.addSprite}
                </button>
              </div>
              <input
                id={`sprite-${characterId}`}
                type="file"
                hidden
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined && spriteLabel !== "") {
                    uploadSprite.mutate({ label: spriteLabel, file });
                    setSpriteLabel("");
                  }
                  event.target.value = "";
                }}
              />
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

              {/* Tags (SPEC §9): chips of what the card has, an add box, and the
                  background task that proposes more from the library's own
                  vocabulary. */}
              <p className="section-label mb-[8px]">{strings.characters.tagFilter}</p>
              <div className="mb-[8px] flex flex-wrap gap-[6px]">
                {character.tags.map((existing) => (
                  <button
                    key={existing}
                    type="button"
                    onClick={() =>
                      save({ tags: character.tags.filter((tag) => tag !== existing) })
                    }
                    className="chrome border px-[10px] py-[6px] text-[9px] tracking-[0.08em] uppercase"
                    style={{
                      borderColor: "var(--onsen-color-border-quiet)",
                      color: "var(--onsen-color-text-muted)",
                    }}
                  >
                    {existing} ×
                  </button>
                ))}
              </div>
              <div className="mb-[8px] flex gap-[6px]">
                <input
                  className="field flex-1"
                  placeholder={strings.characters.tagPrompt}
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const next = tagDraft.trim().toLowerCase();
                    if (next === "" || character.tags.includes(next)) return;
                    save({ tags: [...character.tags, next] });
                    setTagDraft("");
                  }}
                />
                <button
                  type="button"
                  className="btn flex-none"
                  disabled={suggest.isPending}
                  onClick={() =>
                    suggest.mutate(undefined, {
                      onSuccess: ({ tags }) => {
                        const added = tags.filter((tag) => !character.tags.includes(tag));
                        if (added.length > 0) save({ tags: [...character.tags, ...added] });
                      },
                    })
                  }
                >
                  {suggest.isPending ? strings.characters.suggestingTags : strings.characters.suggestTags}
                </button>
              </div>

              {/* Version history (SPEC §9): every save left one behind, and
                  restore takes the card back through them. */}
              <p className="section-label mt-[16px] mb-[8px]">{strings.characters.versions}</p>
              <button
                type="button"
                className="btn w-full"
                onClick={() => setVersionsOpen(true)}
              >
                {strings.characters.versions} · {(versions.data ?? []).length}
              </button>

              {/* AI-assisted authoring (SPEC §9, phase 27): revise names the
                  fields to change; voice notes come back as a proposal. */}
              <p className="section-label mt-[16px] mb-[8px]">{strings.characters.writeWithAi}</p>
              <div className="flex gap-[6px]">
                <button
                  type="button"
                  className="btn flex-1"
                  disabled={authorRevise.isPending}
                  onClick={() => setReviseOpen(true)}
                >
                  {authorRevise.isPending ? strings.characters.writingCard : strings.characters.reviseWithAi}
                </button>
                <button
                  type="button"
                  className="btn flex-1"
                  disabled={authorVoice.isPending}
                  onClick={() =>
                    authorVoice.mutate(undefined, {
                      onSuccess: ({ voiceNotes }) => save({ voiceNotes }),
                    })
                  }
                >
                  {authorVoice.isPending ? strings.characters.writingCard : strings.characters.voiceWithAi}
                </button>
              </div>

              {/* Sprites live on their own tab (DESIGN §295). */}

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
                onClick={() =>
                  confirm(
                    strings.characters.deleteConfirm(character.name),
                    () =>
                      remove.mutate(character.id, {
                        onSuccess: () => navigate({ name: "characters" }),
                      }),
                    { confirmLabel: strings.characters.deleteCharacter },
                  )
                }
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

      {reviseOpen ? (
        <Sheet title={strings.characters.reviseWithAi} onClose={() => setReviseOpen(false)}>
          <div className="pt-[8px] pb-[14px]">
            <textarea
              className="field min-h-[90px] resize-y"
              placeholder={strings.characters.revisePrompt}
              value={reviseDraft}
              onChange={(event) => setReviseDraft(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary mt-[10px] w-full"
              disabled={authorRevise.isPending || reviseDraft.trim() === ""}
              onClick={() => {
                authorRevise.mutate(reviseDraft.trim(), {
                  onSuccess: () => {
                    setReviseOpen(false);
                    setReviseDraft("");
                  },
                });
              }}
            >
              {authorRevise.isPending ? strings.characters.writingCard : strings.characters.reviseWithAi}
            </button>
          </div>
        </Sheet>
      ) : null}

      {versionsOpen ? (
        <Sheet title={strings.characters.versions} onClose={() => setVersionsOpen(false)}>          {(versions.data ?? []).length === 0 ? (
            <p className="chrome py-[10px] text-[9px] tracking-[0.12em] text-ink-dim uppercase">
              {strings.characters.noVersions}
            </p>
          ) : (
            (versions.data ?? []).map((version) => (
              <SheetAction
                key={version.id}
                label={`${version.name} · ${new Date(version.createdAt).toLocaleString()}`}
                onClick={() =>
                  confirm(
                    strings.characters.restoreConfirm,
                    () =>
                      restore.mutate(version.id, {
                        onSuccess: () => setVersionsOpen(false),
                      }),
                    { confirmLabel: strings.characters.restore },
                  )
                }
              />
            ))
          )}
        </Sheet>
      ) : null}
      {confirmNode}
    </div>
  );
}
