import { useState } from "react";
import type { InstalledPackDto, PackInstallDto, PackPlanDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import {
  useExportPack,
  useExportable,
  useInstallPack,
  useUninstallPack,
  useUninstallPreview,
} from "../lib/queries.ts";

/**
 * Installing and removing packs (SPEC §15 tier 2).
 *
 * Every sheet here shows the consequence before the button that causes it. A
 * pack can write a hundred rows at once and remove them again, and the two
 * questions a person actually has - what is this about to add, and what is
 * about to disappear - are the ones the server already answers.
 */

/** The preview, then the install. The same file is sent twice, deliberately. */
export function InstallPackSheet({
  file,
  plan,
  onClose,
}: {
  file: File;
  plan: PackPlanDto;
  onClose(): void;
}) {
  const install = useInstallPack();
  const [result, setResult] = useState<PackInstallDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adds = plan.items.filter((item) => item.action === "add");
  const skips = plan.items.filter((item) => item.action === "skip");

  return (
    <Sheet title={plan.manifest.name} meta={plan.manifest.version} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">
        {plan.manifest.author !== "" ? (
          <p className="chrome mb-[8px] text-[10px] tracking-[0.08em] text-ink-dim uppercase">
            {strings.settings.packBy(plan.manifest.author)}
          </p>
        ) : null}
        {plan.manifest.description !== "" ? (
          <p className="mb-[14px] text-[14px] leading-[1.6] text-ink-prose-muted">
            {plan.manifest.description}
          </p>
        ) : null}

        {plan.problem !== null ? (
          <p className="explain explain-alert mb-[12px]">{plan.problem}</p>
        ) : null}

        {result === null ? (
          <>
            {adds.length > 0 ? (
              <>
                <p className="section-label mb-[8px]">{strings.settings.packAdd}</p>
                {adds.map((item, index) => (
                  <PlanRow key={`${item.kind}-${item.name}-${index}`} item={item} />
                ))}
              </>
            ) : null}

            {skips.length > 0 ? (
              <>
                <p className="section-label mt-[18px] mb-[4px]">{strings.settings.packSkip}</p>
                <p className="explain mb-[8px]">
                  {strings.settings.packSkipHint}
                </p>
                {skips.map((item, index) => (
                  <PlanRow key={`${item.kind}-${item.name}-${index}`} item={item} dim />
                ))}
              </>
            ) : null}

            {plan.strayAssets > 0 ? (
              <p className="explain mt-[14px]">
                {strings.settings.packStrays(plan.strayAssets)}
              </p>
            ) : null}

            {error !== null ? (
              <p className="explain explain-alert mt-[12px]">{error}</p>
            ) : null}

            <button
              type="button"
              className="btn btn-primary mt-[18px] w-full"
              disabled={plan.problem !== null || adds.length === 0 || install.isPending}
              onClick={() =>
                install.mutate(file, {
                  onSuccess: (installed) => setResult(installed),
                  onError: (caught: Error) => setError(caught.message),
                })
              }
            >
              {strings.settings.packInstallConfirm}
            </button>
            <button type="button" className="btn mt-[8px] w-full" onClick={onClose}>
              {strings.settings.packCancel}
            </button>
          </>
        ) : (
          <>
            <p className="chrome mb-[10px] text-[11px] leading-[1.6] text-ink-dim">
              {strings.settings.packInstalled(result.added, result.skipped)}
            </p>
            {result.warnings.map((warning) => (
              <p key={warning} className="explain mb-[6px]">
                {warning}
              </p>
            ))}
            <button type="button" className="btn btn-primary mt-[12px] w-full" onClick={onClose}>
              {strings.settings.packDone}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function PlanRow({
  item,
  dim = false,
}: {
  item: PackPlanDto["items"][number];
  dim?: boolean;
}) {
  return (
    <div className="border-b border-rule py-[9px]" style={{ opacity: dim ? 0.6 : 1 }}>
      <div className="flex items-baseline justify-between gap-[10px]">
        <span className="min-w-0 flex-1 truncate text-[14px]">{item.name}</span>
        <span className="meta flex-none">
          {strings.settings.packKind[item.kind] ?? item.kind}
        </span>
      </div>
      {item.detail !== "" ? (
        <p className="explain mt-[3px]">{item.detail}</p>
      ) : null}
    </div>
  );
}

/** What removing a pack takes with it, listed before the button that does it. */
export function RemovePackSheet({ pack, onClose }: { pack: InstalledPackDto; onClose(): void }) {
  const preview = useUninstallPreview(pack.id);
  const remove = useUninstallPack();

  return (
    <Sheet title={strings.settings.packRemoveTitle} meta={pack.name} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">
        <p className="explain mb-[12px]">
          {strings.settings.packRemoveHint}
        </p>
        {(preview.data?.rows ?? []).map((row, index) => (
          <div key={`${row.table}-${index}`} className="border-b border-rule py-[8px]">
            <span className="text-[14px]">{row.label}</span>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-primary mt-[18px] w-full"
          disabled={remove.isPending}
          onClick={() => remove.mutate(pack.id, { onSuccess: () => onClose() })}
        >
          {strings.settings.packRemoveConfirm}
        </button>
        <button type="button" className="btn mt-[8px] w-full" onClick={onClose}>
          {strings.settings.packCancel}
        </button>
      </div>
    </Sheet>
  );
}

/** Choosing what goes in. A pack is something to share, not a backup. */
export function ExportPackSheet({ onClose }: { onClose(): void }) {
  const here = useExportable();
  const build = useExportPack();

  const [picked, setPicked] = useState<Record<string, Set<string>>>({});
  const [banlist, setBanlist] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(kind: string, id: string) {
    setPicked((current) => {
      const next = new Set(current[kind] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [kind]: next };
    });
  }

  const kinds = [
    "characters",
    "lorebooks",
    "presets",
    "authors",
    "options",
    "regex",
    "triggers",
  ] as const;
  const lists = kinds.map((kind) => ({
    kind,
    rows: (here.data?.[kind] ?? []).map((row) => ({ id: row.ulid, name: row.name })),
  }));

  const chosen = lists.reduce((sum, list) => sum + (picked[list.kind]?.size ?? 0), 0);

  return (
    <Sheet title={strings.settings.packExport} onClose={onClose}>
      <form
        className="pt-[8px] pb-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          build.mutate(
            {
              name: String(form.get("name") ?? "").trim(),
              version: String(form.get("version") ?? "1.0.0").trim(),
              author: String(form.get("author") ?? "").trim(),
              description: String(form.get("description") ?? "").trim(),
              banlist,
              ...Object.fromEntries(lists.map((list) => [list.kind, [...(picked[list.kind] ?? [])]])),
            },
            { onSuccess: () => onClose(), onError: (caught: Error) => setError(caught.message) },
          );
        }}
      >
        <p className="section-label mb-[6px]">{strings.settings.packName}</p>
        <input name="name" className="field mb-[14px]" required />

        <p className="section-label mb-[6px]">{strings.settings.packVersionField}</p>
        <input name="version" className="field mb-[14px]" defaultValue="1.0.0" />

        <p className="section-label mb-[6px]">{strings.settings.packAuthor}</p>
        <input name="author" className="field mb-[14px]" />

        <p className="section-label mb-[6px]">{strings.settings.packDescription}</p>
        <textarea name="description" className="field mb-[18px] min-h-[56px]" />

        <p className="section-label mb-[4px]">{strings.settings.packContents}</p>
        <p className="explain mb-[12px]">
          {strings.settings.packContentsHint}
        </p>

        {lists.map((list) =>
          list.rows.length === 0 ? null : (
            <div key={list.kind} className="mb-[16px]">
              <p className="chrome mb-[6px] text-[9px] tracking-[0.12em] text-ink-dim uppercase">
                {strings.settings.packKind[list.kind] ?? list.kind}
              </p>
              {list.rows.map((row) => (
                <label
                  key={row.id}
                  className="flex min-h-[var(--onsen-tap-target)] items-center gap-[10px] border-b border-rule"
                >
                  <input
                    type="checkbox"
                    checked={picked[list.kind]?.has(row.id) ?? false}
                    onChange={() => toggle(list.kind, row.id)}
                  />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{row.name}</span>
                </label>
              ))}
            </div>
          ),
        )}

        <label className="mb-[16px] flex min-h-[var(--onsen-tap-target)] items-center gap-[10px] border-b border-rule">
          <input
            type="checkbox"
            checked={banlist}
            onChange={(event) => setBanlist(event.target.checked)}
          />
          <span className="flex-1 text-[14px]">{strings.settings.packBanlist}</span>
        </label>

        {error !== null ? (
          <p className="explain explain-alert mb-[12px]">{error}</p>
        ) : null}
        {chosen === 0 && !banlist ? (
          <p className="explain mb-[12px]">
            {strings.settings.packEmpty}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={(chosen === 0 && !banlist) || build.isPending}
        >
          {strings.settings.packMake}
        </button>
      </form>
    </Sheet>
  );
}
