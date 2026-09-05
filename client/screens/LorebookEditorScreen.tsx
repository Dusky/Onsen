import { useState } from "react";
import type {
  LoreDelayFrom,
  LoreEntryDto,
  LoreGroupSelection,
  LorePosition,
  LoreSecondaryLogic,
  LorebookDto,
  UpdateLoreEntryRequest,
} from "@shared/types.ts";
import { LORE_POSITIONS } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { navigate } from "../lib/router.ts";
import {
  useCharacters,
  useCreateLoreEntry,
  useDeleteLoreEntry,
  useDeleteLorebook,
  useLorebook,
  useUpdateLoreEntry,
  useReviseLore,
  useUpdateLorebook,
} from "../lib/queries.ts";

/**
 * The lorebook editor (design `3h`, SPEC §10, §16).
 *
 * One entry is open inline at the top of the list in a red-bordered container
 * — red because it is the live one, the same red the streaming message and the
 * active tab use — and the rest of the book stays visible as hairline rows
 * beneath it. That arrangement is the point of the screen: §10's entries only
 * make sense against their neighbours, because keys collide, inclusion groups
 * compete, and priority is a comparison rather than a value.
 *
 * The open entry commits on `SAVE` rather than on blur, unlike every other
 * editor in the app. An entry is a set of fields that only mean something
 * together — a key with no content, or a group label with no weight, is a
 * half-written rule — and §10 clears timed effects on every edit, so a save per
 * keystroke would also reset a sticky window per keystroke.
 */

function labelForPosition(position: LorePosition): string {
  switch (position) {
    case "before_character":
      return strings.lore.positionBeforeCharacter;
    case "after_character":
      return strings.lore.positionAfterCharacter;
    case "before_examples":
      return strings.lore.positionBeforeExamples;
    case "after_examples":
      return strings.lore.positionAfterExamples;
    case "before_history":
      return strings.lore.positionBeforeHistory;
    case "at_depth":
      return strings.lore.positionAtDepth;
    case "outlet":
      return strings.lore.positionOutlet;
  }
}

function labelForLogic(logic: LoreSecondaryLogic): string {
  switch (logic) {
    case "and_any":
      return strings.lore.logicAndAny;
    case "and_all":
      return strings.lore.logicAndAll;
    case "not_any":
      return strings.lore.logicNotAny;
    case "not_all":
      return strings.lore.logicNotAll;
  }
}

function labelForSelection(selection: LoreGroupSelection): string {
  switch (selection) {
    case "weight":
      return strings.lore.selectionWeight;
    case "prioritize":
      return strings.lore.selectionPrioritize;
    case "score":
      return strings.lore.selectionScore;
  }
}

/** Keys as mono chips, with the design's dashed `+ key` chip at the end. */
function KeyChips({
  keys,
  label,
  onChange,
}: {
  keys: string[];
  label: string;
  onChange(next: string[]): void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function commit() {
    const value = draft.trim();
    setDraft("");
    setAdding(false);
    if (value === "" || keys.includes(value)) return;
    onChange([...keys, value]);
  }

  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(keys.filter((other) => other !== key))}
          aria-label={`${label}: ${key}`}
          className="chrome flex items-center gap-[6px] border border-rule-strong px-[8px] py-[6px] text-[11px] tracking-[0.08em] text-ink-label uppercase"
        >
          {key}
          <span className="text-ink-dim">×</span>
        </button>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          placeholder={strings.lore.keyPlaceholder}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          className="chrome w-[130px] border border-rule-strong bg-bg-input px-[8px] py-[6px] text-[11px] tracking-[0.08em] text-ink uppercase"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="chrome border border-dashed border-rule-strong px-[8px] py-[6px] text-[11px] tracking-[0.08em] text-ink-dim uppercase"
        >
          {strings.lore.addKey}
        </button>
      )}
    </div>
  );
}

/** A bounded whole number, committed into the draft rather than to the server. */
function NumberInput({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | null;
  min: number;
  max: number;
  onChange(value: number | null): void;
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className="section-label mb-[6px] block">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value === null ? "" : String(value)}
        aria-label={label}
        className="field"
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (raw === "") return onChange(null);
          const next = Number.parseInt(raw, 10);
          if (!Number.isInteger(next)) return;
          onChange(Math.min(max, Math.max(min, next)));
        }}
      />
      <span className="chrome mt-[5px] block text-[10.5px] tracking-[0.10em] text-ink-dim uppercase">
        {unit}
      </span>
    </label>
  );
}

function Segments<T extends string>({
  label,
  options,
  value,
  render,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  render(option: T): string;
  onChange(next: T): void;
}) {
  return (
    <div className="mb-[14px]">
      <p className="section-label mb-[6px]">{label}</p>
      <div className="flex flex-wrap gap-[6px]">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`btn ${option === value ? "btn-primary" : ""}`}
          >
            {render(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange(next: boolean): void;
}) {
  return (
    <div className="mb-[14px]">
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-pressed={value}
        className="flex w-full items-center justify-between gap-[10px] py-[6px] text-left"
      >
        <span className="section-label">{label}</span>
        <span
          className="chrome flex-none text-[10.5px] tracking-[0.12em] uppercase"
          style={{ color: value ? "var(--onsen-color-red)" : "var(--onsen-color-text-dim)" }}
        >
          {value ? strings.lore.on : strings.lore.off}
        </span>
      </button>
      {hint === undefined ? null : (
        <p className="explain">{hint}</p>
      )}
    </div>
  );
}

/**
 * The open entry: the design's red-bordered container with an `EDITING` label,
 * its token cost, and a `SAVE` that is the only thing that writes.
 */
function EntryEditor({
  entry,
  book,
  onSave,
  onClose,
  onDelete,
}: {
  entry: LoreEntryDto;
  book: LorebookDto;
  onSave(patch: UpdateLoreEntryRequest): void;
  onClose(): void;
  onDelete(): void;
}) {
  const [draft, setDraft] = useState<LoreEntryDto>(entry);
  const [advanced, setAdvanced] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const characters = useCharacters();
  const revise = useReviseLore(entry.id);

  function set<K extends keyof LoreEntryDto>(field: K, value: LoreEntryDto[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="mb-[18px] border border-red-border bg-bg-raised">
      <div className="flex items-baseline justify-between gap-[10px] border-b border-red-border px-[14px] py-[10px]">
        <p
          className="chrome text-[10.5px] tracking-[0.16em] uppercase"
          style={{ color: "var(--onsen-color-red)" }}
        >
          {strings.lore.editing}
        </p>
        <p className="meta">
          {strings.lore.tokens(draft.tokenCount)}
        </p>
      </div>

      <div className="px-[14px] py-[14px]">
        <p className="section-label mb-[6px]">{strings.lore.entryTitle}</p>
        <input
          className="field mb-[14px]"
          value={draft.title}
          aria-label={strings.lore.entryTitle}
          placeholder={strings.lore.untitled}
          onChange={(event) => set("title", event.target.value)}
        />

        <p className="section-label mb-[6px]">{strings.lore.keys}</p>
        <div className="mb-[14px]">
          <KeyChips
            keys={draft.keys}
            label={strings.lore.keys}
            onChange={(keys) => set("keys", keys)}
          />
        </div>

        <p className="section-label mb-[6px]">{strings.lore.content}</p>
        <textarea
          rows={5}
          className="field mb-[14px] resize-none py-[10px]"
          value={draft.content}
          aria-label={strings.lore.content}
          placeholder={strings.lore.contentPlaceholder}
          onChange={(event) => set("content", event.target.value)}
        />

        <button
          type="button"
          onClick={() => setAdvanced(!advanced)}
          className="chrome mb-[14px] text-[11px] tracking-[0.14em] text-ink-muted uppercase"
        >
          {strings.lore.advanced} {advanced ? "▴" : "▾"}
        </button>

        {advanced ? (
          <div className="mb-[6px]">
            {/* Secondary keys qualify a match rather than causing one (§10). */}
            <p className="section-label mb-[6px]">{strings.lore.secondaryKeys}</p>
            <div className="mb-[6px]">
              <KeyChips
                keys={draft.secondaryKeys}
                label={strings.lore.secondaryKeys}
                onChange={(keys) => set("secondaryKeys", keys)}
              />
            </div>
            <p className="explain mb-[14px]">
              {strings.lore.secondaryKeysHint}
            </p>
            <Segments
              label={strings.lore.secondaryLogic}
              options={["and_any", "and_all", "not_any", "not_all"] as const}
              value={draft.secondaryLogic}
              render={labelForLogic}
              onChange={(logic) => set("secondaryLogic", logic)}
            />

            <Toggle
              label={strings.lore.matchWholeWords}
              hint={strings.lore.matchWholeWordsHint}
              value={draft.matchWholeWords}
              onChange={(on) => set("matchWholeWords", on)}
            />
            <Toggle
              label={strings.lore.caseSensitive}
              value={draft.caseSensitive}
              onChange={(on) => set("caseSensitive", on)}
            />
            <Toggle
              label={strings.lore.constant}
              value={draft.isConstant}
              onChange={(on) => set("isConstant", on)}
            />

            <div className="mb-[14px] flex gap-[10px]">
              <NumberInput
                label={strings.lore.probability}
                unit={strings.lore.probabilityUnit}
                value={draft.probability}
                min={0}
                max={100}
                onChange={(value) => set("probability", value ?? 100)}
              />
              <NumberInput
                label={strings.lore.scanDepth}
                unit={strings.lore.scanDepthUnit}
                value={draft.scanDepth}
                min={0}
                max={200}
                onChange={(value) => set("scanDepth", value)}
              />
            </div>

            {/* Timed effects (§10). All three are counted in messages. */}
            <div className="mb-[10px] flex gap-[10px]">
              <NumberInput
                label={strings.lore.sticky}
                unit={strings.lore.stickyUnit}
                value={draft.sticky}
                min={0}
                max={200}
                onChange={(value) => set("sticky", value ?? 0)}
              />
              <NumberInput
                label={strings.lore.cooldown}
                unit={strings.lore.cooldownUnit}
                value={draft.cooldown}
                min={0}
                max={200}
                onChange={(value) => set("cooldown", value ?? 0)}
              />
            </div>
            <div className="mb-[10px] flex gap-[10px]">
              <NumberInput
                label={strings.lore.delay}
                unit={strings.lore.delayUnit}
                value={draft.delay}
                min={0}
                max={500}
                onChange={(value) => set("delay", value ?? 0)}
              />
            </div>
            <Segments
              label={strings.lore.delayFrom}
              options={["scene_start", "branch_point"] as const}
              value={draft.delayFrom}
              render={(from: LoreDelayFrom) =>
                from === "scene_start"
                  ? strings.lore.delayFromScene
                  : strings.lore.delayFromBranch
              }
              onChange={(from) => set("delayFrom", from)}
            />
            <p className="explain mb-[14px]">
              {strings.lore.timedHint}
            </p>

            {/* Inclusion groups: entries sharing a label compete, one goes in. */}
            <p className="section-label mb-[6px]">{strings.lore.inclusionGroup}</p>
            <input
              className="field mb-[6px]"
              value={draft.inclusionGroup ?? ""}
              aria-label={strings.lore.inclusionGroup}
              onChange={(event) =>
                set("inclusionGroup", event.target.value.trim() === "" ? null : event.target.value)
              }
            />
            <p className="explain mb-[14px]">
              {strings.lore.inclusionGroupHint}
            </p>
            {draft.inclusionGroup === null ? null : (
              <>
                <div className="mb-[14px] flex gap-[10px]">
                  <NumberInput
                    label={strings.lore.groupWeight}
                    unit=""
                    value={draft.groupWeight}
                    min={0}
                    max={1000}
                    onChange={(value) => set("groupWeight", value ?? 100)}
                  />
                </div>
                <Segments
                  label={strings.lore.groupSelection}
                  options={["weight", "prioritize", "score"] as const}
                  value={draft.groupSelection}
                  render={labelForSelection}
                  onChange={(selection) => set("groupSelection", selection)}
                />
              </>
            )}

            {/* The character filter: how two characters in one scene can know
                different things out of one shared book (§10). */}
            <p className="section-label mb-[6px]">{strings.lore.characterFilter}</p>
            <div className="mb-[6px] flex flex-wrap gap-[6px]">
              {(characters.data ?? []).map((character) => {
                const on = draft.characterFilter.includes(character.id);
                return (
                  <button
                    key={character.id}
                    type="button"
                    onClick={() =>
                      set(
                        "characterFilter",
                        on
                          ? draft.characterFilter.filter((id) => id !== character.id)
                          : [...draft.characterFilter, character.id],
                      )
                    }
                    className={`btn ${on ? "btn-primary" : ""}`}
                  >
                    {character.name}
                  </button>
                );
              })}
            </div>
            <p className="explain mb-[14px]">
              {strings.lore.characterFilterHint}
            </p>

            <Segments
              label={strings.lore.position}
              options={LORE_POSITIONS}
              value={draft.position}
              render={labelForPosition}
              onChange={(position) => set("position", position)}
            />
            {draft.position === "at_depth" ? (
              <div className="mb-[14px] flex gap-[10px]">
                <NumberInput
                  label={strings.lore.insertionDepth}
                  unit={strings.lore.insertionDepthUnit}
                  value={draft.insertionDepth}
                  min={0}
                  max={200}
                  onChange={(value) => set("insertionDepth", value ?? 0)}
                />
              </div>
            ) : null}
            {draft.position === "outlet" ? (
              <>
                <p className="section-label mb-[6px]">{strings.lore.outletName}</p>
                <input
                  className="field mb-[14px]"
                  value={draft.outletName ?? ""}
                  aria-label={strings.lore.outletName}
                  onChange={(event) =>
                    set("outletName", event.target.value.trim() === "" ? null : event.target.value)
                  }
                />
              </>
            ) : null}

            <div className="mb-[14px] flex gap-[10px]">
              <NumberInput
                label={strings.lore.recursionLevel}
                unit={strings.lore.recursionLevelUnit}
                value={draft.recursionLevel}
                min={0}
                max={10}
                onChange={(value) => set("recursionLevel", value ?? 0)}
              />
            </div>
            <Toggle
              label={strings.lore.nonRecursable}
              value={draft.nonRecursable}
              onChange={(on) => set("nonRecursable", on)}
            />
            <Toggle
              label={strings.lore.preventFurtherRecursion}
              value={draft.preventFurtherRecursion}
              onChange={(on) => set("preventFurtherRecursion", on)}
            />
            <Toggle
              label={strings.lore.disable}
              value={!draft.enabled}
              onChange={(off) => set("enabled", !off)}
            />
          </div>
        ) : null}
      </div>

      {/* The design's footer row: the activation rule, the priority, and SAVE. */}
      <div className="flex items-center gap-[10px] border-t border-red-border px-[14px] py-[10px]">
        <span className="chrome min-w-0 flex-1 truncate text-[10.5px] tracking-[0.1em] text-ink-dim uppercase">
          {strings.lore.activationLine(draft.isConstant, draft.scanDepth, book.scanDepth)}
        </span>
        <label className="flex flex-none items-center gap-[6px]">
          <span className="chrome text-[10.5px] tracking-[0.1em] text-ink-dim uppercase">
            {strings.lore.priority}
          </span>
          <input
            type="number"
            inputMode="numeric"
            aria-label={strings.lore.priority}
            value={String(draft.insertionOrder)}
            className="chrome w-[58px] border border-rule-strong bg-bg-input px-[6px] py-[8px] text-[11.5px] text-ink"
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              if (Number.isInteger(next)) set("insertionOrder", Math.min(1000, Math.max(0, next)));
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary flex-none"
          onClick={() =>
            onSave({
              title: draft.title,
              content: draft.content,
              enabled: draft.enabled,
              keys: draft.keys,
              secondaryKeys: draft.secondaryKeys,
              secondaryLogic: draft.secondaryLogic,
              caseSensitive: draft.caseSensitive,
              matchWholeWords: draft.matchWholeWords,
              probability: draft.probability,
              isConstant: draft.isConstant,
              scanDepth: draft.scanDepth,
              characterFilter: draft.characterFilter,
              sticky: draft.sticky,
              cooldown: draft.cooldown,
              delay: draft.delay,
              delayFrom: draft.delayFrom,
              inclusionGroup: draft.inclusionGroup,
              groupWeight: draft.groupWeight,
              groupSelection: draft.groupSelection,
              position: draft.position,
              insertionOrder: draft.insertionOrder,
              insertionDepth: draft.insertionDepth,
              outletName: draft.outletName,
              recursionLevel: draft.recursionLevel,
              nonRecursable: draft.nonRecursable,
              preventFurtherRecursion: draft.preventFurtherRecursion,
            })
          }
        >
          {strings.lore.save}
        </button>
      </div>

      <div className="flex items-center gap-[10px] border-t border-rule px-[14px] py-[8px]">
        <button
          type="button"
          className="chrome flex-1 text-[10.5px] tracking-[0.12em] text-ink-muted uppercase"
          disabled={revise.isPending}
          onClick={() =>
            revise.mutate(undefined, {
              onSuccess: (updated) => {
                setDraft((current) => ({ ...current, title: updated.title, content: updated.content, keys: updated.keys }));
              },
            })
          }
        >
          {revise.isPending ? strings.characters.writingCard : strings.characters.reviseWithAi}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="chrome text-[10.5px] tracking-[0.12em] text-ink-dim uppercase"
        >
          {strings.lore.close}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() =>
            confirm(strings.lore.deleteEntryConfirm, onDelete, {
              confirmLabel: strings.lore.deleteEntry,
            })
          }
          className="chrome text-[10.5px] tracking-[0.12em] uppercase"
          style={{ color: "var(--onsen-color-red)" }}
        >
          {strings.lore.deleteEntry}
        </button>
      </div>
      {confirmNode}
    </section>
  );
}

/** A closed entry: Spectral title over a mono line of keys and activation rule. */
function EntryRow({
  entry,
  book,
  onOpen,
}: {
  entry: LoreEntryDto;
  book: LorebookDto;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-baseline gap-[10px] border-b border-rule py-[12px] text-left"
      style={entry.enabled ? undefined : { opacity: 0.55 }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">
          {entry.title === "" ? strings.lore.untitled : entry.title}
        </span>
        <span className="meta mt-[4px] block truncate">
          {entry.enabled
            ? `${entry.keys.length === 0 ? strings.lore.noKeys : entry.keys.join(", ")} · ${strings.lore.activationLine(entry.isConstant, entry.scanDepth, book.scanDepth)}`
            : strings.lore.disabled}
        </span>
      </span>
      <span className="meta flex-none">
        {strings.lore.tokens(entry.tokenCount)}
      </span>
    </button>
  );
}

export function LorebookEditorScreen({ bookId }: { bookId: string }) {
  const query = useLorebook(bookId);
  const updateBook = useUpdateLorebook(bookId);
  const deleteBook = useDeleteLorebook();
  const createEntry = useCreateLoreEntry(bookId);
  const updateEntry = useUpdateLoreEntry(bookId);
  const deleteEntry = useDeleteLoreEntry(bookId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [bookConfirmNode, confirmBook] = useConfirm();

  const book = query.data?.lorebook;
  if (book === undefined) {
    return (
      <div className="flex screen-height items-center justify-center">
        <p className="chrome text-[10.5px] tracking-[0.18em] text-ink-dim uppercase">
          {strings.common.working}
        </p>
      </div>
    );
  }

  const entries = query.data?.entries ?? [];
  const open = entries.find((entry) => entry.id === openId) ?? null;
  const total = entries.reduce((sum, entry) => sum + entry.tokenCount, 0);

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="screen-header hairline flex-none px-[22px] pb-[12px]"
        style={{ paddingTop: "calc(18px + env(safe-area-inset-top))" }}
      >
        <div className="flex w-full items-baseline gap-[12px]">
          <button
            type="button"
            onClick={() => navigate({ name: "lorebooks" })}
            aria-label={strings.common.back}
            className="chrome -ml-[6px] flex h-[34px] w-[24px] items-center text-[18px] text-ink-muted"
          >
            {strings.chat.back}
          </button>
          <div className="min-w-0 flex-1">
            <p className="screen-kicker">{strings.lore.editorKicker}</p>
            <h1 className="truncate text-[19px] font-medium tracking-[-0.01em]">{book.name}</h1>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[16px]">
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
          {/* The book's own settings sit above its entries, because scan depth
              and the budget are what every entry below is measured against. */}
          <p className="section-label mb-[6px]">{strings.lore.name}</p>
          <input
            className="field mb-[14px]"
            defaultValue={book.name}
            key={book.name}
            aria-label={strings.lore.name}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name !== "" && name !== book.name) updateBook.mutate({ name });
            }}
          />

          <div className="mb-[18px] flex gap-[10px]">
            <NumberInput
              label={strings.lore.scanDepth}
              unit={strings.lore.bookScanDepthUnit}
              value={book.scanDepth}
              min={0}
              max={200}
              onChange={(value) =>
                value === null ? undefined : updateBook.mutate({ scanDepth: value })
              }
            />
            <NumberInput
              label={strings.lore.tokenBudget}
              unit={strings.lore.tokenBudgetUnit}
              value={book.tokenBudget}
              min={0}
              max={100_000}
              onChange={(value) =>
                value === null ? undefined : updateBook.mutate({ tokenBudget: value })
              }
            />
          </div>

          {open === null ? null : (
            <EntryEditor
              // Remounted per entry so the draft belongs to the entry it edits
              // rather than to the container.
              key={open.id}
              entry={open}
              book={book}
              onSave={(patch) => updateEntry.mutate({ entryId: open.id, ...patch })}
              onClose={() => setOpenId(null)}
              onDelete={() =>
                deleteEntry.mutate(open.id, { onSuccess: () => setOpenId(null) })
              }
            />
          )}

          {entries.length === 0 ? (
            <EmptyState
              title={strings.lore.entriesEmpty}
              body={strings.lore.entriesEmptyBody}
              actions={[
                {
                  label: strings.lore.addEntry,
                  onClick: () =>
                    createEntry.mutate(undefined, { onSuccess: (entry) => setOpenId(entry.id) }),
                },
              ]}
            />
          ) : null}

          {entries
            .filter((entry) => entry.id !== openId)
            .map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                book={book}
                onOpen={() => setOpenId(entry.id)}
              />
            ))}

          <button
            type="button"
            className="btn mt-[14px] w-full"
            onClick={() =>
              createEntry.mutate(undefined, { onSuccess: (entry) => setOpenId(entry.id) })
            }
          >
            {strings.lore.addEntry}
          </button>

          {/* §10 asks for import and export both, and the import has existed
              since phase 21 with no way back out. */}
          <button
            type="button"
            className="btn mt-[10px] w-full"
            onClick={() => void exportBook(book.id, book.name)}
          >
            {strings.lore.exportBook}
          </button>
          <p className="explain mt-[7px]">
            {strings.lore.exportBookHint}
          </p>

          <button
            type="button"
            className="chrome mt-[18px] mb-[8px] block text-[10.5px] tracking-[0.12em] uppercase"
            style={{ color: "var(--onsen-color-red)" }}
            onClick={() =>
              confirmBook(
                strings.lore.deleteBookConfirm(book.name),
                () =>
                  deleteBook.mutate(book.id, {
                    onSuccess: () => navigate({ name: "lorebooks" }),
                  }),
                { confirmLabel: strings.lore.deleteBook },
              )
            }
          >
            {strings.lore.deleteBook}
          </button>
        </div>
      </main>

      <footer
        className="flex-none border-t border-rule bg-bg-raised px-[22px] pt-[12px]"
        style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}
      >
        <p className="chrome mx-auto w-full max-w-[var(--onsen-prose-measure)] text-[10.5px] tracking-[0.12em] text-ink-dim uppercase">
          {strings.lore.bookTotal(total, entries.length)}
        </p>
      </footer>
      {bookConfirmNode}
    </div>
  );
}

/**
 * Save a book as a world info file.
 *
 * Through fetch rather than a link because the endpoint is behind the session
 * cookie and returns JSON — a link would open it in a tab instead.
 */
async function exportBook(bookId: string, name: string): Promise<void> {
  const response = await fetch(`/api/lorebooks/${bookId}/export`);
  if (!response.ok) return;
  const text = JSON.stringify(await response.json(), null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^\w -]+/g, "").trim() || "world-info"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
