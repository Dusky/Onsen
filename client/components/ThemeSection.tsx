import { useMemo, useRef, useState } from "react";
import {
  useActivateTheme,
  useCreateTheme,
  useDeleteTheme,
  useImportTheme,
  useThemes,
  useUpdateTheme,
} from "../lib/queries.ts";
import { strings } from "../strings.ts";
import type { ThemeDto, ThemeImportDto } from "@shared/types.ts";

/**
 * Themes (SPEC §20 phase 45).
 *
 * The Reading category's own search words have promised `theme`, `font` and
 * `size` since it was written, and until now it held a chime toggle. This is
 * the rest of it.
 */

/** The token rows worth putting in front of a person, grouped as they read. */
const GROUPS: Array<{ label: string; rows: Array<{ token: string; label: string }> }> = [
  {
    label: "Surfaces",
    rows: [
      { token: "color-bg", label: "ground" },
      { token: "color-bg-raised", label: "raised" },
      { token: "color-bg-sunken", label: "sunken" },
      { token: "color-rule", label: "rule" },
      { token: "color-rule-strong", label: "rule, strong" },
    ],
  },
  {
    label: "Ink",
    rows: [
      { token: "color-text", label: "prose" },
      { token: "color-text-label", label: "labels" },
      { token: "color-text-muted", label: "secondary" },
      { token: "color-text-dim", label: "tertiary" },
    ],
  },
  {
    label: "Accents",
    rows: [
      { token: "color-red", label: "live · now" },
      { token: "color-blue", label: "the author" },
      { token: "color-green", label: "connected" },
    ],
  },
];

/** Depth, as the four values that used to be a rule rather than a setting. */
const DEPTH_ROWS: Array<{ token: string; label: string; hint: string }> = [
  { token: "radius", label: "corner", hint: "0px flat · 9px cards" },
  { token: "border-width", label: "border", hint: "1px hairline · 0 for fill only" },
  { token: "shadow-card", label: "lift, a turn", hint: "none, or a CSS shadow" },
  { token: "shadow-panel", label: "lift, a panel", hint: "none, or a CSS shadow" },
];

function isHex(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value.trim());
}

function Row({
  label,
  token,
  value,
  swatch,
  hint,
  disabled,
  onCommit,
}: {
  label: string;
  token: string;
  value: string;
  swatch: boolean;
  hint?: string | undefined;
  disabled: boolean;
  onCommit(next: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const bad = swatch && shown.trim() !== "" && !isHex(shown);

  return (
    <div className="flex items-center gap-[11px] py-[4px]">
      {swatch ? (
        <span
          className="h-[26px] w-[26px] flex-none border border-rule"
          style={{ background: isHex(shown) ? shown : "transparent" }}
        />
      ) : null}
      <span className="chrome min-w-0 flex-1 text-[12px] text-ink">
        {label}
        {hint !== undefined ? (
          <span className="block text-[10px] text-ink-dim">{hint}</span>
        ) : null}
      </span>
      <input
        aria-label={token}
        className="chrome w-[132px] border-b bg-transparent px-[3px] py-[6px]
                   text-right text-[12px] text-ink-muted"
        style={{ borderColor: bad ? "var(--onsen-color-red)" : "var(--onsen-color-rule)" }}
        disabled={disabled}
        value={shown}
        placeholder="—"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(draft.trim());
          setDraft(null);
        }}
      />
    </div>
  );
}

/**
 * What an imported theme's CSS would be allowed to do, before any of it runs.
 *
 * The rule this is built on: tokens are data and land immediately; CSS is code
 * and waits. An imported theme is somebody else's, and CSS can reach the
 * network — which is the one thing worth stopping in a self-hosted app whose
 * whole premise is that nothing leaves the machine.
 */
function PendingCss({ theme }: { theme: ThemeDto }) {
  const update = useUpdateTheme(theme.id);
  if (theme.pendingCss.trim() === "") return null;
  return (
    <div className="mt-[14px] border border-red-border bg-red-bg p-[13px]">
      <p className="chrome mb-[7px] text-[11px] text-red-text">
        {strings.settings.themeCssPending}
      </p>
      <pre className="chrome mt-[8px] mb-[11px] max-h-[160px] overflow-auto text-[11px]
                      leading-[1.6] whitespace-pre-wrap text-ink-muted">
        {theme.pendingCss}
      </pre>
      <div className="flex gap-[8px]">
        <button
          type="button"
          className="btn btn-primary flex-1"
          onClick={() => update.mutate({ approvePendingCss: true })}
        >
          {strings.settings.themeCssApprove}
        </button>
        <button
          type="button"
          className="btn flex-1"
          onClick={() => update.mutate({ discardPendingCss: true })}
        >
          {strings.settings.themeCssDiscard}
        </button>
      </div>
    </div>
  );
}

export function ThemeSection() {
  const themes = useThemes();
  const activate = useActivateTheme();
  const create = useCreateTheme();
  const remove = useDeleteTheme();
  const importTheme = useImportTheme();
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<ThemeImportDto | null>(null);

  const list = themes.data?.themes ?? [];
  const activeId = themes.data?.activeId ?? null;
  const active = useMemo(() => list.find((t) => t.id === activeId) ?? null, [list, activeId]);
  const update = useUpdateTheme(active?.id ?? "");

  const editable = active !== null && !active.isBuiltin;

  function setToken(token: string, value: string) {
    if (active === null) return;
    const next = { ...active.tokens };
    if (value === "" || value === "—") delete next[token];
    else next[token] = value;
    update.mutate({ tokens: next });
  }

  return (
    <div className="mb-[26px]">
      <p className="section-label mb-[4px]">{strings.settings.theme}</p>
      <p className="explain mb-[12px]">
        {strings.settings.themeHint}
      </p>

      <div className="mb-[14px] flex flex-wrap gap-[6px]">
        {list.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={`btn ${theme.id === activeId ? "btn-primary" : ""}`}
            onClick={() => {
              if (theme.id !== activeId) activate.mutate(theme.id);
            }}
          >
            {theme.name}
          </button>
        ))}
      </div>

      <div className="mb-[18px] flex flex-wrap gap-[8px]">
        <button
          type="button"
          className="btn min-w-[92px] flex-1"
          disabled={active === null || create.isPending}
          onClick={() => {
            if (active === null) return;
            create.mutate(
              { name: `${active.name} copy`, from: active.id },
              { onSuccess: (made) => activate.mutate(made.id) },
            );
          }}
        >
          {strings.settings.themeDuplicate}
        </button>
        <button
          type="button"
          className="btn min-w-[92px] flex-1"
          disabled={!editable}
          onClick={() => {
            if (active !== null) remove.mutate(active.id);
          }}
        >
          {strings.settings.themeDelete}
        </button>
        <a
          className="btn flex min-w-[92px] flex-1 items-center justify-center no-underline"
          href={active === null ? "#" : `/api/themes/${active.id}/export`}
        >
          {strings.settings.themeExport}
        </a>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file === undefined) return;
            setNotice(null);
            importTheme.mutate(file, {
              onSuccess: (result) => setReport(result),
              onError: (error) => setNotice(error.message),
            });
          }}
        />
        <button
          type="button"
          className="btn min-w-[92px] flex-1"
          disabled={importTheme.isPending}
          onClick={() => fileInput.current?.click()}
        >
          {strings.settings.themeImport}
        </button>
      </div>

      {notice !== null ? (
        <p className="explain explain-alert mb-[12px]">{notice}</p>
      ) : null}
      {report !== null ? (
        <p className="chrome mb-[12px] text-[10px] leading-[1.6] text-ink-muted">
          {strings.settings.themeImported(report.theme.name)}
          {report.droppedTokens.length > 0
            ? ` ${strings.settings.themeDropped(report.droppedTokens.length)}`
            : ""}
          {report.concerns.length > 0 ? ` ${report.concerns.join(" ")}` : ""}
        </p>
      ) : null}

      {active === null ? null : (
        <>
          {active.isBuiltin ? (
            <p className="explain mb-[12px]">
              {strings.settings.themeBuiltin}
            </p>
          ) : null}

          <PendingCss theme={active} />

          {GROUPS.map((group) => (
            <div key={group.label} className="mb-[16px]">
              <p className="chrome mb-[5px] text-[11px] font-medium text-ink-muted">{group.label}</p>
              {group.rows.map((row) => (
                <Row
                  key={row.token}
                  label={row.label}
                  token={row.token}
                  value={active.tokens[row.token] ?? ""}
                  swatch
                  disabled={!editable}
                  onCommit={(next) => setToken(row.token, next)}
                />
              ))}
            </div>
          ))}

          <div className="mb-[16px]">
            <p className="chrome mb-[5px] text-[11px] font-medium text-ink-muted">
              {strings.settings.themeDepth}
            </p>
            {DEPTH_ROWS.map((row) => (
              <Row
                key={row.token}
                label={row.label}
                token={row.token}
                hint={row.hint}
                value={active.tokens[row.token] ?? ""}
                swatch={false}
                disabled={!editable}
                onCommit={(next) => setToken(row.token, next)}
              />
            ))}
          </div>

          <div className="mb-[8px]">
            <p className="chrome mb-[5px] text-[11px] font-medium text-ink-muted">
              {strings.settings.themeCss}
            </p>
            <textarea
              className="field font-mono text-[12px]"
              rows={4}
              disabled={!editable}
              defaultValue={active.customCss}
              placeholder={strings.settings.themeCssPlaceholder}
              onBlur={(event) => {
                if (event.target.value !== active.customCss) {
                  update.mutate({ customCss: event.target.value });
                }
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
