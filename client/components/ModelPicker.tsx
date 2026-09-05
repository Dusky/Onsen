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
          <div className="mb-[8px] flex items-center justify-between gap-[10px]">
            <span className="meta">{strings.settings.modelsFound(models.length)}</span>
            {/* A provider like OpenRouter lists hundreds; without this the list
                is a wall rather than a choice. */}
            {models.length > 8 ? (
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={strings.settings.modelsFilter}
                aria-label={strings.settings.modelsFilter}
                className="field h-[34px] min-h-[34px] max-w-[190px] flex-1 px-[8px] py-0 text-[13px]"
              />
            ) : null}
          </div>
          <div className="flex max-h-[190px] flex-wrap gap-[5px] overflow-y-auto">
            {shown.map((model) => (
              <button
                key={model}
                type="button"
                onClick={() => onPick(model)}
                className={`btn min-h-[34px] px-[9px] ${model === selected ? "btn-primary" : ""}`}
                style={{ textTransform: "none", letterSpacing: "0.02em" }}
              >
                {model}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
