import type { ReactNode } from "react";
import { useState } from "react";
import { strings } from "../strings.ts";
import { useFetchModels } from "../lib/queries.ts";

/**
 * Ask a provider what it serves, and show the answer (SPEC §16).
 *
 * This used to be a bare button that filled a `<datalist>`. The call worked —
 * 200, models parsed, options in the DOM — and a `<datalist>` renders nothing
 * until the field is focused and typed into, so from the reader's side the
 * button did nothing at all. A list you can see and press is the whole fix.
 *
 * Shared by the provider editor and the setup wizard rather than written twice:
 * the wizard is where somebody meets this app for the first time, and it is the
 * screen that most needs to answer "what do I put in the model box".
 */
/** Below this a list is short enough to read; above it, searching is the way. */
const SEARCH_FROM = 8;
/** How many rows are drawn at once. Narrowing the search is what reveals more. */
const RENDER_CAP = 60;

export function ModelPicker({
  request,
  onPick,
  selected,
  emptyMessage,
  children,
}: {
  /** Read at click time, because the form around this is still being typed into. */
  request(): { kind?: string; baseUrl: string; apiKey?: string; providerId?: string };
  onPick(model: string): void;
  /** Highlighted in the list, so a chosen model stays visible after picking. */
  selected?: string;
  /** Shown when there is no address to ask. A profile's reason differs. */
  emptyMessage?: string;
  /**
   * The model field itself. It sits inside this component rather than beside
   * it because the results have to appear *below* the row: rendered as a
   * sibling in the caller's flex row, the panel took its share of the width
   * and squeezed the input down to a stub.
   */
  children: ReactNode;
}) {
  const fetchModels = useFetchModels();
  const [models, setModels] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  function run() {
    const body = request();
    if (body.baseUrl.trim() === "") {
      setError(emptyMessage ?? strings.settings.modelsAddressFirst);
      return;
    }
    setError(null);
    fetchModels.mutate(body, {
      onSuccess: ({ models: found }) => {
        setModels(found);
        setFilter("");
      },
      onError: (caught: Error) => {
        setModels(null);
        setError(caught.message);
      },
    });
  }

  const needle = filter.trim().toLowerCase();
  const shown = models === null ? [] : models.filter((m) => m.toLowerCase().includes(needle));

  return (
    <div>
      <div className="flex gap-[6px]">
        {children}
        <button
          type="button"
          className="btn flex-none"
          disabled={fetchModels.isPending}
          onClick={run}
        >
          {fetchModels.isPending ? strings.settings.fetchingModels : strings.settings.fetchModels}
        </button>
      </div>

      {error !== null ? <p className="explain explain-alert mt-[8px]">{error}</p> : null}

      {models !== null && models.length === 0 ? (
        <p className="explain mt-[8px]">{strings.settings.modelsNone}</p>
      ) : null}

      {models !== null && models.length > 0 ? (
        <div className="mt-[10px] border border-rule bg-bg-raised p-[10px]">
          {/*
           * OpenRouter and the larger aggregators serve several hundred models.
           * A wrapped row of chips is a wall at that size, so this is a search
           * over a list: one model per line, the field first because with three
           * hundred of them typing is the only way anyone finds one.
           */}
          {models.length > SEARCH_FROM ? (
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={strings.settings.modelsFilter}
              aria-label={strings.settings.modelsFilter}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="field mb-[8px] h-[38px] min-h-[38px] w-full px-[10px] py-0 text-[14px]"
            />
          ) : null}

          <div className="mb-[7px] flex items-baseline justify-between gap-[10px]">
            <span className="meta">
              {shown.length === models.length
                ? strings.settings.modelsFound(models.length)
                : strings.settings.modelsShowing(shown.length, models.length)}
            </span>
          </div>

          {shown.length === 0 ? (
            <p className="explain">{strings.settings.modelsNoMatch}</p>
          ) : (
            <div className="flex max-h-[240px] flex-col overflow-y-auto">
              {shown.slice(0, RENDER_CAP).map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => onPick(model)}
                  aria-pressed={model === selected}
                  className="chrome flex min-h-[38px] items-center truncate border-b border-rule px-[8px] text-left text-[13px] last:border-b-0"
                  style={
                    model === selected
                      ? {
                          background: "var(--onsen-color-red-bg)",
                          color: "var(--onsen-color-text-bright)",
                        }
                      : { color: "var(--onsen-color-text-label)" }
                  }
                >
                  {model}
                </button>
              ))}
            </div>
          )}

          {/* Rendering four hundred rows to show the first ten is waste, and a
              list nobody can reach the bottom of is not a choice either. */}
          {shown.length > RENDER_CAP ? (
            <p className="explain mt-[7px]">
              {strings.settings.modelsMore(shown.length - RENDER_CAP)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
