import { useEffect, useRef, useState } from "react";
import type {
  LoreBindingDto,
  LoreBindingScope,
  LoreDelayFrom,
  LoreEntryDto,
  LoreGroupSelection,
  LorePosition,
  LoreSecondaryLogic,
  LorebookDto,
  UpdateLoreEntryRequest,
} from "@shared/types.ts";
import { INJECTION_ROLES, LORE_BINDING_SCOPES, LORE_POSITIONS } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { useConfirm } from "../components/ConfirmSheet.tsx";
import { Sheet, SheetAction } from "../components/Sheet.tsx";
import { Notice } from "../components/Notice.tsx";
import { TagEditor } from "../components/TagEditor.tsx";
import { useIsDesktop } from "../lib/breakpoint.ts";
import {
  useBindLorebook,
  useCharacters,
  useCopyLoreEntry,
  useCreateLoreEntry,
  useCreateLorebook,
  useDeleteLoreEntry,
  useDeleteLorebook,
  useDuplicateLoreEntry,
  useImportLorebook,
  useLorebook,
  useLorebooks,
  useMoveLoreEntry,
  usePersonas,
  useScenes,
  useUnbindLorebook,
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

/** What a binding says, in the book list and the bindings panel. */
export function bindingLabel(binding: LoreBindingDto): string {
  switch (binding.scope) {
    case "global":
      return strings.lore.bindingGlobal;
    case "scene":
      return strings.lore.bindingScene(binding.targetName ?? "\u2014");
    case "character":
      return strings.lore.bindingCharacter(binding.targetName ?? "\u2014");
    case "persona":
      return strings.lore.bindingPersona(binding.targetName ?? "\u2014");
  }
}

/**
 * The book list, with create and import (§20 phase 123).
 *
 * Rendered as a rail on a desktop and as the whole page on a phone, so it
 * owns the actions that make a book and leaves the editor to own the book
 * itself.
 */
function BookList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const books = useLorebooks();
  const create = useCreateLorebook();
  const importBook = useImportLorebook();
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function onFile(file: File | undefined) {
    if (file === undefined) return;
    setNotice(null);
    importBook.mutate(file, {
      onSuccess: (result) => {
        setNotice(strings.lore.imported(result.lorebook.name, result.entries));
        onSelect(result.lorebook.id);
      },
      onError: (error) => setNotice(error.message),
    });
  }

  const none = books.data !== undefined && books.data.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {notice !== null ? <Notice>{notice}</Notice> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {none ? (
          <EmptyState
            title={strings.lore.empty}
            actions={[
              {
                label: strings.lore.create,
                onClick: () =>
                  create.mutate({ name: "New lorebook" }, { onSuccess: (book) => onSelect(book.id) }),
              },
              {
                label: importBook.isPending ? strings.lore.importing : strings.lore.import,
                onClick: () => fileInput.current?.click(),
                disabled: importBook.isPending,
              },
            ]}
          />
        ) : (
          (books.data ?? []).map((book) => (
            <BookListRow
              key={book.id}
              book={book}
              active={book.id === selectedId}
              onSelect={() => onSelect(book.id)}
            />
          ))
        )}
      </div>

      {none ? null : (
        <div className="flex-none border-t border-rule px-[16px] py-[10px]">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              onFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="flex gap-[8px]">
            <button
              type="button"
              className="btn flex-1"
              disabled={importBook.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {importBook.isPending ? strings.lore.importing : strings.lore.import}
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              onClick={() =>
                create.mutate({ name: "New lorebook" }, { onSuccess: (book) => onSelect(book.id) })
              }
            >
              {strings.lore.create}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A book in the library rail, with its mute switch (§20 phase 131). */
function BookListRow({
  book,
  active,
  onSelect,
}: {
  book: LorebookDto;
  active: boolean;
  onSelect(): void;
}) {
  const update = useUpdateLorebook(book.id);
  const remove = useDeleteLorebook();
  const [confirmNode, confirm] = useConfirm();
  return (
    <>
    <div
      className="row flex w-full items-center gap-[10px]"
      style={active ? { background: "var(--onsen-color-bg-inset)" } : book.enabled ? undefined : { opacity: 0.55 }}
      onContextMenu={(event) => {
        // Right-click is the desktop's long-press: delete this book.
        event.preventDefault();
        confirm(
          strings.lore.deleteBookConfirm(book.name),
          () => remove.mutate(book.id),
          { confirmLabel: strings.lore.deleteBook },
        );
      }}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[15px] font-medium">{book.name}</span>
        <span className="meta mt-[4px] block truncate">
          {book.ownerAuthorName !== null
            ? strings.lore.ownedBy(book.ownerAuthorName)
            : book.bindings.length === 0
              ? strings.lore.unbound
              : book.bindings.map(bindingLabel).join(" · ")}
        </span>
      </button>
      <button
        type="button"
        onClick={() => update.mutate({ enabled: !book.enabled })}
        aria-pressed={book.enabled}
        className="chrome flex-none text-[12.5px]"
        style={{ color: book.enabled ? "var(--onsen-color-blue)" : "var(--onsen-color-text-dim)" }}
      >
        {book.enabled ? strings.lore.on : strings.lore.off}
      </button>
      <span className="meta flex-none">{strings.lore.entries(book.entryCount)}</span>
    </div>
    {confirmNode}
    </>
  );
}

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

function labelForTrigger(trigger: string): string {
  switch (trigger) {
    case "normal":
      return strings.lore.fireOnNormal;
    case "swipe":
      return strings.lore.fireOnSwipe;
    case "revise":
      return strings.lore.fireOnRevise;
    case "continue":
      return strings.lore.fireOnContinue;
    default:
      return trigger;
  }
}

function labelForMatchField(field: string): string {
  switch (field) {
    case "persona_description":
      return strings.lore.matchPersonaDescription;
    case "character_description":
      return strings.lore.matchCharacterDescription;
    case "character_personality":
      return strings.lore.matchCharacterPersonality;
    case "character_depth_prompt":
      return strings.lore.matchCharacterDepthPrompt;
    case "scenario":
      return strings.lore.matchScenario;
    case "creator_notes":
      return strings.lore.matchCreatorNotes;
    default:
      return field;
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
          className="chrome flex items-center gap-[6px] border border-rule-strong px-[8px] py-[6px] text-[13px] text-ink-label"
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
          className="chrome w-[130px] border border-rule-strong bg-bg-input px-[8px] py-[6px] text-[13px] text-ink"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="chrome border border-dashed border-rule-strong px-[8px] py-[6px] text-[13px] text-ink-dim"
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
      <span className="chrome mt-[5px] block text-[12.5px] text-ink-dim">
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
          className="chrome flex-none text-[12.5px]"
          style={{ color: value ? "var(--onsen-color-blue)" : "var(--onsen-color-text-dim)" }}
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
  const [transfer, setTransfer] = useState<"move" | "copy" | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const characters = useCharacters();
  const revise = useReviseLore(entry.id);
  const books = useLorebooks();
  const moveEntry = useMoveLoreEntry(entry.lorebookId);
  const copyEntry = useCopyLoreEntry(entry.lorebookId);
  const duplicate = useDuplicateLoreEntry(entry.lorebookId);

  function set<K extends keyof LoreEntryDto>(field: K, value: LoreEntryDto[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    // Blue, not red: the entry open for editing is a selection the reader
    // made, not a live or destructive state (design review fix 1, follow-up
    // sweep).
    <section className="mb-[18px] border border-blue-border bg-bg-raised">
      <div className="flex items-baseline justify-between gap-[10px] border-b border-blue-border px-[14px] py-[10px]">
        <p
          className="chrome text-[12.5px]"
          style={{ color: "var(--onsen-color-blue)" }}
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
            onChange={(keys) => {
              // SillyTavern's addMemo: the first key names an entry that has
              // no title of its own (§20 phase 136).
              set("keys", keys);
              if (draft.title === "" && keys.length > draft.keys.length) {
                set("title", keys[keys.length - 1] ?? draft.title);
              }
            }}
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
          className="chrome mb-[14px] text-[13px] text-ink-muted"
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
            <Toggle
              label={strings.lore.vectorized}
              hint={strings.lore.vectorizedNote}
              value={draft.vectorized}
              onChange={(on) => set("vectorized", on)}
            />

            {/* §20 phase 54. `insertionRole` decides which role the injected
                text lands in — `server/prompt/blocks.ts` has consumed it since
                phase 21 and nothing could set it. An imported book arrives
                carrying a value the editor could not show. */}
            <Segments
              label={strings.lore.insertionRole}
              options={INJECTION_ROLES}
              value={draft.insertionRole}
              render={(role) =>
                role === "system"
                  ? strings.lore.roleSystem
                  : role === "user"
                    ? strings.lore.roleUser
                    : strings.lore.roleAssistant
              }
              onChange={(role) => set("insertionRole", role)}
            />

            {/* The other end of a loop that was already firing: a trigger can
                name an automation id (§14) and no screen could put one on an
                entry. */}
            <p className="section-label mb-[6px]">{strings.lore.automationId}</p>
            <input
              className="field mb-[14px]"
              value={draft.automationId ?? ""}
              aria-label={strings.lore.automationId}
              placeholder={strings.lore.automationIdPlaceholder}
              spellCheck={false}
              onChange={(event) =>
                set("automationId", event.target.value.trim() === "" ? null : event.target.value)
              }
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

            <Toggle
              label={strings.lore.useProbability}
              value={draft.useProbability}
              onChange={(on) => set("useProbability", on)}
            />
            <Toggle
              label={strings.lore.ignoreBudget}
              value={draft.ignoreBudget}
              onChange={(on) => set("ignoreBudget", on)}
            />

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
              <NumberInput
                label={strings.lore.delayUntilRecursion}
                unit={strings.lore.delayUntilRecursionUnit}
                value={draft.delayUntilRecursion}
                min={0}
                max={10}
                onChange={(value) => set("delayUntilRecursion", value ?? 0)}
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
                <Toggle
                  label={strings.lore.groupOverride}
                  value={draft.groupOverride}
                  onChange={(on) => set("groupOverride", on)}
                />
              </>
            )}

            {/* The generation types this entry fires on (§20 phase 134). */}
            <p className="section-label mb-[6px]">{strings.lore.fireOn}</p>
            <div className="mb-[6px] flex flex-wrap gap-[6px]">
              {(["normal", "swipe", "revise", "continue"] as const).map((type) => {
                const on = draft.triggers.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() =>
                      set(
                        "triggers",
                        on ? draft.triggers.filter((t) => t !== type) : [...draft.triggers, type],
                      )
                    }
                    aria-pressed={on}
                    className={`btn flex-none ${on ? "btn-primary" : ""}`}
                  >
                    {labelForTrigger(type)}
                  </button>
                );
              })}
            </div>
            <p className="explain mb-[14px]">{strings.lore.fireOnHint}</p>

            {/* The card fields this entry also scans against (§20 phase 135). */}
            <p className="section-label mb-[6px]">{strings.lore.matchAgainst}</p>
            <div className="mb-[14px] flex flex-wrap gap-[6px]">
              {([
                "character_description",
                "character_personality",
                "character_depth_prompt",
                "scenario",
                "creator_notes",
                "persona_description",
              ] as const).map((field) => {
                const on = draft.matchAgainst.includes(field);
                return (
                  <button
                    key={field}
                    type="button"
                    onClick={() =>
                      set(
                        "matchAgainst",
                        on ? draft.matchAgainst.filter((f) => f !== field) : [...draft.matchAgainst, field],
                      )
                    }
                    aria-pressed={on}
                    className={`btn flex-none ${on ? "btn-primary" : ""}`}
                  >
                    {labelForMatchField(field)}
                  </button>
                );
              })}
            </div>

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
            <Toggle
              label={strings.lore.filterExclude}
              value={draft.characterFilterExclude}
              onChange={(on) => set("characterFilterExclude", on)}
            />
            <p className="section-label mb-[6px]">{strings.characters.tagFilter}</p>
            <TagEditor
              tags={draft.characterFilterTags}
              onChange={(tags) => set("characterFilterTags", tags)}
              placeholder={strings.characters.tagPrompt}
            />

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
        <span className="chrome min-w-0 flex-1 truncate text-[12.5px] text-ink-dim">
          {strings.lore.activationLine(draft.isConstant, draft.scanDepth, book.scanDepth)}
        </span>
        <label className="flex flex-none items-center gap-[6px]">
          <span className="chrome text-[12.5px] text-ink-dim">
            {strings.lore.priority}
          </span>
          <input
            type="number"
            inputMode="numeric"
            aria-label={strings.lore.priority}
            value={String(draft.insertionOrder)}
            className="chrome w-[58px] border border-rule-strong bg-bg-input px-[6px] py-[8px] text-[13.5px] text-ink"
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
              insertionRole: draft.insertionRole,
              automationId: draft.automationId,
              caseSensitive: draft.caseSensitive,
              matchWholeWords: draft.matchWholeWords,
              probability: draft.probability,
              isConstant: draft.isConstant,
              vectorized: draft.vectorized,
              scanDepth: draft.scanDepth,
              characterFilter: draft.characterFilter,
              sticky: draft.sticky,
              cooldown: draft.cooldown,
              delay: draft.delay,
              delayFrom: draft.delayFrom,
              inclusionGroup: draft.inclusionGroup,
              triggers: draft.triggers,
              matchAgainst: draft.matchAgainst,
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
          className="chrome flex-1 text-[12.5px] text-ink-muted"
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
          className="chrome text-[12.5px] text-ink-dim"
        >
          {strings.lore.close}
        </button>
        <button
          type="button"
          onClick={() => setTransfer("copy")}
          className="chrome text-[12.5px] text-ink-muted"
        >
          {strings.lore.copyTo}
        </button>
        <button
          type="button"
          onClick={() => setTransfer("move")}
          className="chrome text-[12.5px] text-ink-muted"
        >
          {strings.lore.moveTo}
        </button>
        <button
          type="button"
          disabled={duplicate.isPending}
          onClick={() => duplicate.mutate(entry.id, { onSuccess: () => onClose() })}
          className="chrome text-[12.5px] text-ink-muted"
        >
          {strings.lore.duplicate}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() =>
            confirm(strings.lore.deleteEntryConfirm, onDelete, {
              confirmLabel: strings.lore.deleteEntry,
            })
          }
          className="chrome text-[12.5px]"
          style={{ color: "var(--onsen-color-red)" }}
        >
          {strings.lore.deleteEntry}
        </button>
      </div>

      {transfer === null ? null : (
        <div className="border-t border-rule px-[14px] py-[10px]">
          <p className="section-label mb-[6px]">
            {transfer === "move" ? strings.lore.moveTo : strings.lore.copyTo}
          </p>
          {(books.data ?? [])
            .filter((candidate) => candidate.id !== entry.lorebookId)
            .map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="row w-full text-left"
                onClick={() => {
                  const run = transfer === "move" ? moveEntry : copyEntry;
                  run.mutate(
                    { entryId: entry.id, toBookId: candidate.id },
                    { onSuccess: () => { setTransfer(null); onClose(); } },
                  );
                }}
              >
                <span className="text-[14px] font-medium">{candidate.name}</span>
              </button>
            ))}
          {(books.data ?? []).length <= 1 ? (
            <p className="explain mt-[6px]">{strings.lore.noOtherBooks}</p>
          ) : null}
          <button
            type="button"
            className="chrome mt-[10px] text-[12.5px] text-ink-dim"
            onClick={() => setTransfer(null)}
          >
            {strings.common.cancel}
          </button>
        </div>
      )}
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
  const duplicate = useDuplicateLoreEntry(book.id);
  const remove = useDeleteLoreEntry(book.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  return (
    <>
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={(event) => {
        // Right-click is the desktop's long-press: duplicate or delete.
        event.preventDefault();
        setMenuOpen(true);
      }}
      className="flex w-full items-baseline gap-[10px] border-b border-rule py-[12px] text-left"
      style={entry.enabled ? undefined : { opacity: 0.55 }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">
          {/* Constant entries carry the live amber, the same state the writing
              indicator uses — a rule that is always on is a rule that is "now". */}
          {entry.isConstant ? (
            <span
              aria-hidden="true"
              className="mr-[7px]"
              style={{ color: "var(--onsen-color-amber)" }}
            >
              {"\u25cf"}
            </span>
          ) : null}
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

    {menuOpen ? (
      <Sheet
        title={entry.title === "" ? strings.lore.untitled : entry.title}
        onClose={() => setMenuOpen(false)}
      >
        <SheetAction
          label={strings.lore.duplicate}
          onClick={() => {
            duplicate.mutate(entry.id, { onSuccess: () => setMenuOpen(false) });
          }}
        />
        <SheetAction
          label={strings.lore.deleteEntry}
          destructive
          onClick={() =>
            confirm(
              strings.lore.deleteEntryConfirm,
              () => {
                remove.mutate(entry.id);
                setMenuOpen(false);
              },
              { confirmLabel: strings.lore.deleteEntry },
            )
          }
        />
      </Sheet>
    ) : null}
    {confirmNode}
    </>
  );
}

/**
 * The entry list's order (SPEC §10, §16). Priority puts constant entries
 * first, then active, then disabled — the order a reader actually scans —
 * with insertion order breaking ties; the other modes are the obvious ones.
 */
function sortEntries(
  entries: LoreEntryDto[],
  mode: "priority" | "order" | "title" | "recent",
): LoreEntryDto[] {
  const sorted = [...entries];
  if (mode === "title") {
    sorted.sort(
      (a, b) => a.title.localeCompare(b.title) || b.insertionOrder - a.insertionOrder,
    );
  } else if (mode === "order") {
    sorted.sort((a, b) => b.insertionOrder - a.insertionOrder);
  } else if (mode === "recent") {
    sorted.sort((a, b) => b.updatedAt - a.updatedAt);
  } else {
    const rank = (entry: LoreEntryDto) => (!entry.enabled ? 2 : entry.isConstant ? 0 : 1);
    sorted.sort(
      (a, b) => rank(a) - rank(b) || b.insertionOrder - a.insertionOrder,
    );
  }
  return sorted;
}

/**
 * What this book is attached to, and the only place that can change it
 * (SPEC §10, §16).
 *
 * Until phase 54 exactly one scope could be created anywhere in the app: a
 * roleplay's lore sheet attached books to itself. A book bound globally or
 * carried by a character was visible everywhere and removable nowhere, and
 * `LoreSheet` says as much — it declines to detach those because they are
 * "attached somewhere else". This is the somewhere else.
 *
 * A book the app writes keeps its bindings on display and out of reach: a
 * dossier book detached from its author would render into nothing, with
 * nothing to say so.
 */
function Bindings({ book }: { book: LorebookDto }) {
  const scenes = useScenes();
  const characters = useCharacters();
  const personas = usePersonas();
  const bind = useBindLorebook();
  const unbind = useUnbindLorebook();
  const [scope, setScope] = useState<LoreBindingScope>("global");
  const [targetId, setTargetId] = useState("");

  if (book.ownerAuthorName !== null) {
    return (
      <div className="mb-[18px]">
        <p className="section-label mb-[6px]">{strings.lore.bindings}</p>
        <p className="explain">{strings.lore.ownedBy(book.ownerAuthorName)}</p>
      </div>
    );
  }

  const taken = new Set(
    book.bindings.map((binding) => `${binding.scope}:${binding.targetId ?? ""}`),
  );
  const candidates: { id: string; name: string }[] =
    scope === "scene"
      ? (scenes.data ?? []).map((scene) => ({ id: scene.id, name: scene.title }))
      : scope === "character"
        ? (characters.data ?? []).map((character) => ({
            id: character.id,
            name: character.name,
          }))
        : scope === "persona"
          ? (personas.data ?? []).map((persona) => ({ id: persona.id, name: persona.name }))
          : [];
  const offered = candidates.filter((row) => !taken.has(`${scope}:${row.id}`));
  const chosen = offered.some((row) => row.id === targetId) ? targetId : (offered[0]?.id ?? "");
  const canAttach =
    scope === "global" ? !taken.has("global:") : chosen !== "";

  function attach() {
    if (!canAttach) return;
    bind.mutate(
      scope === "global" ? { bookId: book.id, scope } : { bookId: book.id, scope, targetId: chosen },
    );
    setTargetId("");
  }

  return (
    <div className="mb-[18px]">
      <p className="section-label mb-[6px]">{strings.lore.bindings}</p>

      {book.bindings.length === 0 ? (
        <p className="explain mb-[10px]">{strings.lore.unbound}</p>
      ) : (
        book.bindings.map((binding) => (
          <div
            key={binding.id}
            className="flex items-baseline gap-[10px] border-b border-rule py-[10px]"
          >
            <span className="min-w-0 flex-1 truncate text-[14px]">{bindingLabel(binding)}</span>
            {book.managed ? (
              <span className="meta flex-none">{strings.lore.managedNote}</span>
            ) : (
              <button
                type="button"
                onClick={() => unbind.mutate({ bookId: book.id, bindingId: binding.id })}
                className="chrome flex-none text-[12.5px]"
                style={{ color: "var(--onsen-color-red)" }}
              >
                {strings.lore.detach}
              </button>
            )}
          </div>
        ))
      )}

      {book.managed ? null : (
        <div className="mt-[12px]">
          <Segments
            label={strings.lore.attachTo}
            options={LORE_BINDING_SCOPES}
            value={scope}
            render={(option) => {
              switch (option) {
                case "global":
                  return strings.lore.scopeGlobal;
                case "scene":
                  return strings.lore.scopeScene;
                case "character":
                  return strings.lore.scopeCharacter;
                case "persona":
                  return strings.lore.scopePersona;
              }
            }}
            onChange={(next) => {
              setScope(next);
              setTargetId("");
            }}
          />
          <div className="flex gap-[8px]">
            {scope === "global" ? null : (
              <select
                className="field min-w-0 flex-1"
                aria-label={strings.lore.attachTo}
                value={chosen}
                disabled={offered.length === 0}
                onChange={(event) => setTargetId(event.target.value)}
              >
                {offered.length === 0 ? <option value="">{strings.lore.nothingToAttach}</option> : null}
                {offered.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn flex-none"
              disabled={!canAttach || bind.isPending}
              onClick={attach}
            >
              {strings.lore.attach}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The selected book's editor: settings, bindings, entries and the open entry. */
function BookEditor({ bookId, onBack }: { bookId: string; onBack?: () => void }) {
  const query = useLorebook(bookId);
  const updateBook = useUpdateLorebook(bookId);
  const deleteBook = useDeleteLorebook();
  const createEntry = useCreateLoreEntry(bookId);
  const updateEntry = useUpdateLoreEntry(bookId);
  const deleteEntry = useDeleteLoreEntry(bookId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [entrySearch, setEntrySearch] = useState("");
  const [entrySort, setEntrySort] = useState<"priority" | "order" | "title" | "recent">("priority");
  const [bookConfirmNode, confirmBook] = useConfirm();

  const book = query.data?.lorebook;
  if (book === undefined) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="chrome text-[12.5px] text-ink-dim">
          {strings.common.working}
        </p>
      </div>
    );
  }

  const entries = query.data?.entries ?? [];
  const open = entries.find((entry) => entry.id === openId) ?? null;
  const total = entries.reduce((sum, entry) => sum + entry.tokenCount, 0);

  // The closed entries, narrowed by the search box and ordered by the sort.
  // The open entry stays open regardless — it is the one being edited, not
  // a row in the list.
  const needle = entrySearch.trim().toLowerCase();
  const listed = entries.filter((entry) => entry.id !== openId);
  const visible = sortEntries(
    needle === ""
      ? listed
      : listed.filter(
          (entry) =>
            entry.title.toLowerCase().includes(needle) ||
            entry.keys.some((key) => key.toLowerCase().includes(needle)) ||
            entry.content.toLowerCase().includes(needle),
        ),
    entrySort,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <header
        className="screen-header hairline flex-none px-[22px] pb-[12px]"
        style={{ paddingTop: "18px" }}
      >
        <div className="flex w-full items-baseline gap-[12px]">
          {onBack === undefined ? null : (
            <button
              type="button"
              onClick={onBack}
              aria-label={strings.common.back}
              className="chrome -ml-[6px] flex h-[34px] w-[24px] items-center text-[18px] text-ink-muted"
            >
              {strings.chat.back}
            </button>
          )}
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
            <NumberInput
              label={strings.lore.recursionDepth}
              unit={strings.lore.recursionDepthUnit}
              value={book.recursionDepth}
              min={0}
              max={20}
              onChange={(value) =>
                value === null ? undefined : updateBook.mutate({ recursionDepth: value })
              }
            />
          </div>

          <Bindings book={book} />

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
              actions={[
                {
                  label: strings.lore.addEntry,
                  onClick: () =>
                    createEntry.mutate(undefined, { onSuccess: (entry) => setOpenId(entry.id) }),
                },
              ]}
            />
          ) : (
            <>
              {/* Search and sort the entry list the way SillyTavern does: a
                  search box, and priority as the default order (§20 phase 124). */}
              <div className="mb-[12px] flex gap-[6px]">
                <input
                  className="field min-h-0 min-w-0 flex-1 py-[8px] text-[13px]"
                  placeholder={strings.lore.entrySearch}
                  aria-label={strings.lore.entrySearch}
                  value={entrySearch}
                  onChange={(event) => setEntrySearch(event.target.value)}
                />
                <select
                  className="field min-h-0 flex-none py-[8px]"
                  aria-label={strings.lore.entrySearch}
                  value={entrySort}
                  onChange={(event) =>
                    setEntrySort(event.target.value as "priority" | "order" | "title" | "recent")
                  }
                >
                  <option value="priority">{strings.lore.sortPriority}</option>
                  <option value="order">{strings.lore.sortOrder}</option>
                  <option value="title">{strings.lore.sortTitle}</option>
                  <option value="recent">{strings.lore.sortRecent}</option>
                </select>
              </div>

              {visible.length === 0 ? (
                <p className="explain">{strings.lore.noMatches}</p>
              ) : (
                visible.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    book={book}
                    onOpen={() => setOpenId(entry.id)}
                  />
                ))
              )}
            </>
          )}

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

          <button
            type="button"
            className="chrome mt-[18px] mb-[8px] block text-[12.5px]"
            style={{ color: "var(--onsen-color-red)" }}
            onClick={() =>
              confirmBook(
                strings.lore.deleteBookConfirm(book.name),
                () =>
                  deleteBook.mutate(book.id, {
                    onSuccess: () => onBack?.(),
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
        <p className="chrome mx-auto w-full max-w-[var(--onsen-prose-measure)] text-[12.5px] text-ink-dim">
          {strings.lore.bookTotal(total, entries.length)}
        </p>
      </footer>
      {bookConfirmNode}
    </div>
  );
}

/**
 * The lore library and its editor on one page (SPEC §10, §16, §20 phase 123).
 *
 * SillyTavern keeps world info on a single surface; this does the same. On a
 * desktop the books are a rail beside the editor; on a phone the books list
 * and the editor swap in place, so a lorebook is edited where it is browsed
 * rather than behind a second route.
 */
export function LoreScreen({ bookId }: { bookId?: string | null }) {
  const isDesktop = useIsDesktop();
  const [selectedId, setSelectedId] = useState<string | null>(bookId ?? null);

  // A deep link into a book changes the prop, not the component instance;
  // follow it so a link to one book then another does not show the first.
  useEffect(() => {
    if (bookId !== undefined && bookId !== null) setSelectedId(bookId);
  }, [bookId]);

  if (isDesktop) {
    return (
      <div className="flex screen-height flex-col bg-bg">
        <header
          className="screen-header screen-header-wide hairline flex-none px-[22px] pb-[14px]"
          style={{ paddingTop: "22px" }}
        >
          <p className="screen-kicker">{strings.lore.kicker}</p>
          <h1 className="screen-title mt-[6px]">{strings.lore.title}</h1>
        </header>
        <div className="flex min-h-0 flex-1">
          <aside className="w-[280px] flex-none border-r border-rule">
            <BookList selectedId={selectedId} onSelect={setSelectedId} />
          </aside>
          {selectedId === null ? (
            <main className="flex min-h-0 flex-1 items-center justify-center">
              <p className="explain">{strings.lore.pickBook}</p>
            </main>
          ) : (
            <BookEditor bookId={selectedId} />
          )}
        </div>
      </div>
    );
  }

  if (selectedId === null) {
    return (
      <div className="flex screen-height flex-col bg-bg">
        <header
          className="screen-header screen-header-wide hairline flex-none px-[22px] pb-[14px]"
          style={{ paddingTop: "22px" }}
        >
          <p className="screen-kicker">{strings.lore.kicker}</p>
          <h1 className="screen-title mt-[6px]">{strings.lore.title}</h1>
        </header>
        <div className="min-h-0 flex-1 px-[22px] py-[14px]">
          <div className="mx-auto h-full w-full max-w-[var(--onsen-list-measure)]">
            <BookList selectedId={null} onSelect={setSelectedId} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex screen-height flex-col">
      <BookEditor bookId={selectedId} onBack={() => setSelectedId(null)} />
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
