import { useEffect, useState, type ReactNode } from "react";
import type { AuthorDto, UpdateAuthorRequest } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import { useAuthor, useAuthors, useCreateAuthor, useDeleteAuthor, useUpdateAuthor } from "../lib/queries.ts";
import { TabBar } from "../components/TabBar.tsx";

/**
 * The author: the AI's own identity, and the product's defining bet.
 *
 * The editor is presented as a card, like a character's, because that is what
 * it is — the difference is that this one is the identity in the system prompt
 * rather than a role being played. The sample voice block renders the
 * out-of-character field in the exact treatment the user will meet it in, so
 * they are configuring a voice they can see rather than a text field.
 */

const CONTEXT_WINDOW = 32_768;

function Field({
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

function TextField({
  value,
  onCommit,
  rows = 1,
}: {
  value: string;
  onCommit(next: string): void;
  rows?: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return rows > 1 ? (
    <textarea
      className="field resize-y"
      style={{ minHeight: `${rows * 26 + 20}px` }}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  ) : (
    <input
      className="field"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export function AuthorsScreen() {
  const authors = useAuthors();
  const create = useCreateAuthor();

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="hairline flex-none px-[22px] pb-[14px]"
        style={{ paddingTop: "calc(22px + env(safe-area-inset-top))" }}
      >
        <p className="screen-kicker">{strings.authors.kicker}</p>
        <h1 className="screen-title mt-[6px]">{strings.authors.listTitle}</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[14px]">
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
          <p className="mb-[22px] text-[length:var(--onsen-text-prose-excerpt)] leading-[1.55] text-ink-prose-muted">
            {strings.authors.explainer}
          </p>

          {authors.data?.length === 0 ? (
            <p className="chrome text-[10px] tracking-[0.14em] text-ink-dim uppercase">
              {strings.authors.empty}
            </p>
          ) : null}

          {authors.data?.map((author) => (
            <button
              key={author.id}
              type="button"
              onClick={() => navigate({ name: "author", authorId: author.id })}
              className="w-full border-b border-rule py-[15px] text-left"
            >
              <div className="flex items-baseline justify-between gap-[12px]">
                <span className="truncate text-[17px] font-medium">{author.name}</span>
                {author.isDefault ? (
                  <span
                    className="chrome flex-none text-[8.5px] tracking-[0.12em] uppercase"
                    style={{ color: "var(--onsen-color-red)" }}
                  >
                    {strings.authors.isDefault}
                  </span>
                ) : null}
              </div>
              <p className="mt-[6px] line-clamp-2 text-[length:var(--onsen-text-prose-excerpt)] leading-[1.5] text-ink-prose-muted">
                {author.personality ?? author.writingStyle ?? "—"}
              </p>
            </button>
          ))}
        </div>
      </main>

      <footer className="flex-none border-t border-rule bg-bg-raised px-[22px] py-[12px]">
        <button
          type="button"
          className="btn btn-primary mx-auto block w-full max-w-[var(--onsen-prose-measure)]"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(
              {},
              { onSuccess: (author) => navigate({ name: "author", authorId: author.id }) },
            )
          }
        >
          {strings.authors.create}
        </button>
      </footer>

      <TabBar active="authors" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function AuthorEditorScreen({ authorId }: { authorId: string }) {
  const query = useAuthor(authorId);
  const update = useUpdateAuthor(authorId);
  const remove = useDeleteAuthor();

  const author: AuthorDto | undefined = query.data;
  if (author === undefined) {
    return (
      <div className="flex screen-height items-center justify-center">
        <p className="chrome text-[9px] tracking-[0.18em] text-ink-dim uppercase">
          {strings.common.working}
        </p>
      </div>
    );
  }

  const save = (patch: UpdateAuthorRequest) => update.mutate(patch);
  const tokens = author.tokens;

  return (
    <div className="flex screen-height flex-col bg-bg">
      <header
        className="hairline flex flex-none items-baseline gap-[12px] px-[22px] pb-[12px]"
        style={{ paddingTop: "calc(18px + env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={() => navigate({ name: "authors" })}
          aria-label={strings.common.back}
          className="chrome -ml-[6px] flex h-[34px] w-[24px] items-center text-[18px] text-ink-muted"
        >
          {strings.chat.back}
        </button>
        <div className="min-w-0 flex-1">
          <p className="screen-kicker">{strings.authors.kicker}</p>
          <h1 className="truncate text-[19px] font-medium tracking-[-0.01em]">{author.name}</h1>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[16px]">
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
          <Field label={strings.authors.name}>
            <TextField value={author.name} onCommit={(name) => save({ name })} />
          </Field>

          <Field
            label={strings.authors.personality}
            tokens={tokens.personality}
            hint={strings.authors.personalityHint}
          >
            <TextField
              value={author.personality ?? ""}
              rows={5}
              onCommit={(personality) => save({ personality: personality || null })}
            />
          </Field>

          <Field
            label={strings.authors.writingStyle}
            tokens={tokens.writingStyle}
            hint={strings.authors.writingStyleHint}
          >
            <TextField
              value={author.writingStyle ?? ""}
              rows={4}
              onCommit={(writingStyle) => save({ writingStyle: writingStyle || null })}
            />
          </Field>

          <Field
            label={strings.authors.directingStyle}
            tokens={tokens.directingStyle}
            hint={strings.authors.directingStyleHint}
          >
            <TextField
              value={author.directingStyle ?? ""}
              rows={3}
              onCommit={(directingStyle) => save({ directingStyle: directingStyle || null })}
            />
          </Field>

          {/* The out-of-character voice takes the blue pencil: it is the author
              speaking as itself rather than as the story. */}
          <div className="mb-[18px]">
            <div className="mb-[8px] flex items-baseline justify-between gap-[10px]">
              <span
                className="section-label"
                style={{ color: "var(--onsen-color-blue)" }}
              >
                {strings.authors.oocVoice}
              </span>
              <span className="chrome text-[8.5px] text-ink-dim">
                {strings.characters.tokens(tokens.oocVoice)}
              </span>
            </div>
            <TextField
              value={author.oocVoice ?? ""}
              rows={3}
              onCommit={(oocVoice) => save({ oocVoice: oocVoice || null })}
            />
          </div>

          {/* A live preview in the exact treatment the voice will appear in, so
              the user is configuring something they can see. */}
          <div className="mb-[22px]">
            <p className="section-label mb-[8px]">{strings.authors.sampleVoice}</p>
            <div
              className="pl-[18px]"
              style={{ borderLeft: "2px solid var(--onsen-color-blue)" }}
            >
              <p
                className="chrome mb-[6px] text-[9px] tracking-[0.18em] uppercase"
                style={{ color: "var(--onsen-color-blue)" }}
              >
                {author.name} · OOC
              </p>
              <div
                className="px-[11px] py-[9px]"
                style={{
                  background: "var(--onsen-color-blue-bg)",
                  border: "1px solid var(--onsen-color-blue-border)",
                  borderRadius: "3px 12px 12px 12px",
                }}
              >
                <p
                  className="chrome text-[12.5px] leading-[1.55]"
                  style={{ color: "var(--onsen-color-blue-text)" }}
                >
                  {author.oocVoice ?? strings.authors.sampleVoiceEmpty}
                </p>
              </div>
            </div>
          </div>

          {/* Boundaries take the red pencil. */}
          <div className="mb-[18px]">
            <div className="mb-[8px] flex items-baseline justify-between gap-[10px]">
              <span className="section-label" style={{ color: "var(--onsen-color-red)" }}>
                {strings.authors.boundaries}
              </span>
              <span className="chrome text-[8.5px] text-ink-dim">
                {strings.characters.tokens(tokens.boundaries)}
              </span>
            </div>
            <TextField
              value={author.boundaries ?? ""}
              rows={3}
              onCommit={(boundaries) => save({ boundaries: boundaries || null })}
            />
            <p className="chrome mt-[7px] text-[9.5px] leading-[1.5] text-ink-dim">
              {strings.authors.boundariesHint}
            </p>
          </div>

          <button
            type="button"
            onClick={() => save({ memoryEnabled: !author.memoryEnabled })}
            className="mb-[18px] flex w-full items-center justify-between gap-[12px] border-y border-rule py-[14px] text-left"
          >
            <span className="min-w-0">
              <span className="section-label">{strings.authors.memory}</span>
              <span className="chrome mt-[6px] block text-[9.5px] leading-[1.5] text-ink-dim">
                {strings.authors.memoryHint}
              </span>
            </span>
            {/* A square toggle, not a pill (design handoff). */}
            <span
              className="flex h-[22px] w-[42px] flex-none items-center border"
              style={{
                borderColor: author.memoryEnabled
                  ? "var(--onsen-color-red)"
                  : "var(--onsen-color-rule-strong)",
                justifyContent: author.memoryEnabled ? "flex-end" : "flex-start",
                padding: "2px",
              }}
            >
              <span
                className="h-[16px] w-[16px]"
                style={{
                  background: author.memoryEnabled
                    ? "var(--onsen-color-red)"
                    : "var(--onsen-color-text-dim)",
                }}
              />
            </span>
          </button>

          {!author.isDefault ? (
            <button
              type="button"
              className="btn mb-[12px] w-full"
              onClick={() => save({ isDefault: true })}
            >
              {strings.authors.makeDefault}
            </button>
          ) : null}

          <button
            type="button"
            className="btn mb-[24px] w-full"
            style={{
              color: "var(--onsen-color-red)",
              borderColor: "var(--onsen-color-red-border)",
            }}
            onClick={() => {
              if (!window.confirm(strings.authors.deleteConfirm(author.name))) return;
              remove.mutate(author.id, { onSuccess: () => navigate({ name: "authors" }) });
            }}
          >
            {strings.authors.deleteAuthor}
          </button>
        </div>
      </main>

      <footer
        className="flex-none border-t border-rule bg-bg-raised px-[22px] pt-[11px]"
        style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-[var(--onsen-prose-measure)]">
          <div className="flex items-baseline justify-between">
            <span className="section-label">{strings.authors.cardTotal}</span>
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
