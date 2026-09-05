import { useState } from "react";
import type { BanListDto, BanPhraseDto, OptionGroupDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";

/**
 * Choosing within one option group (SPEC §13.5).
 *
 * One sheet per group rather than one screen of every option, because seven
 * groups of four to six is thirty-odd switches and the design's rule is
 * progressive disclosure. The cardinality is stated at the top and enforced by
 * the server, so a `one_of` group behaves like a radio without needing to be
 * drawn as one.
 *
 * Every option carries its token cost, which is §13.5's whole argument for
 * modelling this natively: a labelled block with a price beats a toggle whose
 * effect on the prompt you cannot see.
 */
export function OptionGroupSheet({
  group,
  onSet,
  onClose,
}: {
  group: OptionGroupDto;
  onSet(optionId: string, on: boolean): void;
  onClose(): void;
}) {
  const oneOf = group.cardinality === "one_of";
  return (
    <Sheet
      title={group.name}
      meta={oneOf ? strings.sceneSetup.optionsOneOf : strings.sceneSetup.optionsAnyOf}
      onClose={onClose}
    >
      <div className="pt-[6px] pb-[14px]">
        <p className="explain mb-[14px]">
          {group.description}
        </p>

        {group.options.map((option) => (
          <button
            key={option.id}
            type="button"
            // In a one-of group, pressing the selected option would leave the
            // group empty — which the cardinality says cannot happen. So it is
            // a no-op rather than a toggle.
            onClick={() => {
              if (oneOf && option.selected) return;
              onSet(option.id, !option.selected);
            }}
            className="flex w-full items-baseline gap-[10px] border-b border-rule py-[13px] text-left"
          >
            <span
              className="chrome mt-[1px] w-[9px] flex-none text-[12.5px] leading-none"
              style={{ color: "var(--onsen-color-red)" }}
              aria-hidden
            >
              {option.selected ? (oneOf ? "●" : "▪") : ""}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block text-[14px]"
                style={{
                  color: option.selected
                    ? "var(--onsen-color-text)"
                    : "var(--onsen-color-text-muted)",
                }}
              >
                {option.name}
              </span>
              {/* The words themselves, because a rule you cannot read is a
                  rule you cannot judge. */}
              <span className="chrome mt-[4px] block text-[10.5px] leading-[1.55] text-ink-dim">
                {option.fragment.trim() === ""
                  ? strings.sceneSetup.optionsEmpty
                  : option.fragment}
              </span>
            </span>
            <span className="meta flex-none">
              {option.tokenCount === 0 ? "—" : `${option.tokenCount} TOK`}
            </span>
          </button>
        ))}

        <button type="button" className="btn btn-primary mt-[16px] w-full" onClick={onClose}>
          {strings.sceneSetup.optionsDone}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The ban list (SPEC §13.6).
 *
 * Three origins, drawn apart because they mean different things: shipped
 * phrases everybody starts with, phrases this reader added, and **proposals**
 * from the analyser that are not enforced until accepted. That last distinction
 * is the one that matters — a background task that silently started banning
 * phrases would be editing somebody's prose on its own authority.
 */
export function BanListSheet({
  state,
  analysing,
  detail,
  onAdd,
  onAnalyse,
  onUpdate,
  onDelete,
  onClose,
}: {
  state: BanListDto | undefined;
  analysing: boolean;
  detail: string | null;
  onAdd(phrase: string, scoped: boolean): void;
  onAnalyse(): void;
  onUpdate(banId: string, patch: { accept?: boolean; enabled?: boolean }): void;
  onDelete(banId: string): void;
  onClose(): void;
}) {
  const [scoped, setScoped] = useState(false);
  const phrases = state?.phrases ?? [];
  const proposed = phrases.filter((row) => row.origin === "proposed");
  const settled = phrases.filter((row) => row.origin !== "proposed");

  return (
    <Sheet
      title={strings.sceneSetup.bans}
      meta={state === undefined ? undefined : `${state.tokenCount} TOK`}
      onClose={onClose}
    >
      <div className="pt-[6px] pb-[14px]">

        <form
          className="mb-[10px]"
          onSubmit={(event) => {
            event.preventDefault();
            const field = event.currentTarget.elements.namedItem("phrase");
            if (field instanceof HTMLInputElement && field.value.trim() !== "") {
              onAdd(field.value.trim(), scoped);
              field.value = "";
            }
          }}
        >
          <input
            name="phrase"
            className="field mb-[6px]"
            placeholder={strings.sceneSetup.bansPlaceholder}
            autoComplete="off"
          />
          <div className="flex gap-[6px]">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                className={`btn flex-1 ${scoped === value ? "btn-primary" : ""}`}
                onClick={() => setScoped(value)}
              >
                {value ? strings.sceneSetup.bansScopeScene : strings.sceneSetup.bansScopeGlobal}
              </button>
            ))}
            <button type="submit" className="btn">
              {strings.sceneSetup.bansAdd}
            </button>
          </div>
        </form>

        <button
          type="button"
          className="btn mb-[16px] w-full"
          disabled={analysing}
          onClick={onAnalyse}
        >
          {analysing ? strings.sceneSetup.bansAnalysing : strings.sceneSetup.bansAnalyse}
        </button>
        {detail === null ? null : (
          <p className="explain mb-[14px]">{detail}</p>
        )}

        {/* Proposals first, because they are the only rows that want a decision. */}
        {proposed.length === 0 ? null : (
          <>
            <p className="section-label mb-[6px]">{strings.sceneSetup.bansProposed}</p>
            {proposed.map((row) => (
              <BanRow key={row.id} row={row} onUpdate={onUpdate} onDelete={onDelete} />
            ))}
            <div className="h-[16px]" />
          </>
        )}

        {settled.length === 0 && proposed.length === 0 ? (
          <p className="chrome text-[11px] text-ink-dim">{strings.sceneSetup.bansEmpty}</p>
        ) : null}
        {settled.map((row) => (
          <BanRow key={row.id} row={row} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
      </div>
    </Sheet>
  );
}

/**
 * One phrase.
 *
 * A proposal gets the full treatment because it is the only row that wants a
 * decision. Everything already settled is one compact line — sixteen shipped
 * phrases with two full-width buttons each would be thirty-two buttons in a
 * sheet, which is a list nobody scrolls to the end of.
 */
function BanRow({
  row,
  onUpdate,
  onDelete,
}: {
  row: BanPhraseDto;
  onUpdate(banId: string, patch: { accept?: boolean; enabled?: boolean }): void;
  onDelete(banId: string): void;
}) {
  const marks = [
    row.enabled ? null : strings.sceneSetup.bansOff,
    row.isGlobal ? strings.sceneSetup.bansGlobal : strings.sceneSetup.bansScopeScene,
    // Recurrence is the evidence a proposal is judged on (§13.6).
    row.hits > 0 ? strings.sceneSetup.bansHits(row.hits) : null,
  ].filter((mark): mark is string => mark !== null);

  if (row.origin === "proposed") {
    return (
      <div className="border-b border-rule py-[11px]">
        <div className="flex items-baseline gap-[10px]">
          <span className="min-w-0 flex-1 text-[13.5px]">{row.phrase}</span>
          <span className="chrome flex-none text-[10px] text-ink-dim">
            {strings.sceneSetup.bansHits(row.hits)}
          </span>
        </div>
        <div className="mt-[8px] flex gap-[6px]">
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={() => onUpdate(row.id, { accept: true })}
          >
            {strings.sceneSetup.bansAccept}
          </button>
          <button
            type="button"
            className="btn"
            style={{ borderColor: "var(--onsen-color-red)", color: "var(--onsen-color-red)" }}
            onClick={() => onDelete(row.id)}
          >
            {strings.sceneSetup.bansRemove}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-[8px] border-b border-rule">
      {/* The row itself toggles it. A phrase switched off is dimmed and says so,
          which is the state, where a button labelled "off" is a question. */}
      <button
        type="button"
        onClick={() => onUpdate(row.id, { enabled: !row.enabled })}
        className="flex min-h-[40px] min-w-0 flex-1 items-baseline gap-[8px] py-[10px] text-left"
      >
        <span
          className="min-w-0 flex-1 truncate text-[13.5px]"
          style={{
            color: row.enabled ? "var(--onsen-color-text)" : "var(--onsen-color-text-dim)",
          }}
        >
          {row.phrase}
        </span>
        <span className="chrome flex-none text-[10px] text-ink-dim">
          {marks.join(" · ")}
        </span>
      </button>
      <button
        type="button"
        aria-label={`${strings.sceneSetup.bansRemove}: ${row.phrase}`}
        onClick={() => onDelete(row.id)}
        className="chrome min-h-[40px] flex-none px-[8px] text-[13px] leading-none"
        style={{ color: "var(--onsen-color-red)" }}
      >
        ×
      </button>
    </div>
  );
}
