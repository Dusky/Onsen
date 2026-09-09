import { useState } from "react";
import { useExtensions, useUpdateExtension, useDeleteExtension, useExtensionActions, useRunGlobalExtensionAction } from "../lib/queries.ts";
import { Sheet } from "./Sheet.tsx";
import { strings } from "../strings.ts";
import type { ExtensionDto, ExtensionSettingsField } from "@shared/types.ts";

/**
 * Installed extensions, managed (SPEC §15 tier 3, §20 phase 143).
 *
 * The list shows enable/disable, settings, and uninstall. Settings are declared
 * by the extension as a schema and rendered here — the host draws the form, so
 * an extension never ships UI code.
 */

function fieldValue(extension: ExtensionDto, field: ExtensionSettingsField): string | number | boolean {
  const stored = extension.settings[field.key];
  if (stored !== undefined) return stored as string | number | boolean;
  return field.default ?? defaultValueFor(field.type);
}

function defaultValueFor(type: ExtensionSettingsField["type"]): string | number | boolean {
  switch (type) {
    case "boolean":
      return false;
    case "number":
      return 0;
    default:
      return "";
  }
}

function ExtensionSettingsSheet({ extension, onClose }: { extension: ExtensionDto; onClose(): void }) {
  const update = useUpdateExtension();
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => {
    const out: Record<string, string | number | boolean> = {};
    for (const field of extension.settingsSchema) out[field.key] = fieldValue(extension, field);
    return out;
  });

  if (extension.settingsSchema.length === 0) return null;

  return (
    <Sheet title={strings.settings.extensionSettingsTitle(extension.name)} onClose={onClose}>
      <form
        className="pt-[8px] pb-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate(
            { id: extension.id, settings: values },
            { onSuccess: onClose },
          );
        }}
      >
        {extension.settingsSchema.map((field) => (
          <div key={field.key} className="mb-[14px]">
            <p className="section-label mb-[6px]">{field.label}</p>
            {field.type === "boolean" ? (
              <label className="row flex items-center gap-[9px]">
                <input
                  type="checkbox"
                  checked={values[field.key] === true}
                  onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.checked }))}
                />
                <span className="text-[14px]">{values[field.key] === true ? strings.settings.opEnabled : strings.settings.opDisabled}</span>
              </label>
            ) : field.type === "select" ? (
              <select
                className="field"
                value={String(values[field.key])}
                onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value }))}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                className="field min-h-[96px] resize-y"
                value={String(values[field.key])}
                onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value }))}
              />
            ) : (
              <input
                className="field"
                type={field.type === "number" ? "number" : "text"}
                min={field.min}
                max={field.max}
                value={String(values[field.key])}
                onChange={(event) => {
                  const raw = event.target.value;
                  const value = field.type === "number" ? Number(raw) : raw;
                  setValues((v) => ({ ...v, [field.key]: value }));
                }}
              />
            )}
          </div>
        ))}
        <div className="flex gap-[8px]">
          <button type="submit" className="btn btn-primary flex-1" disabled={update.isPending}>
            {strings.settings.extensionSave}
          </button>
          <button type="button" className="btn flex-none px-[16px]" onClick={onClose}>
            {strings.settings.packCancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function ExtensionsSection() {
  const extensions = useExtensions();
  const update = useUpdateExtension();
  const remove = useDeleteExtension();
  const actions = useExtensionActions();
  const runGlobal = useRunGlobalExtensionAction();
  const [settingsFor, setSettingsFor] = useState<ExtensionDto | null>(null);

  const list = extensions.data ?? [];
  const globalActions = (actions.data ?? []).filter((action) => action.scope === "global");
  const settingsTarget = settingsFor === null
    ? null
    : list.find((e) => e.id === settingsFor.id) ?? settingsFor;

  return (
    <section>
      <p className="chrome mb-[2px] text-[11px]">{strings.settings.extensionInstallNote}</p>
      {/* Global actions: app-wide, no scene (§150). */}
      {globalActions.map((action) => (
        <div key={action.key} className="row flex items-center gap-[9px]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium">{action.label}</p>
            {action.description === null || action.description === "" ? null : (
              <p className="chrome truncate text-[12.5px] text-ink-dim">{action.description}</p>
            )}
          </div>
          <button
            type="button"
            className="btn flex-none px-[12px]"
            disabled={runGlobal.isPending}
            onClick={() => runGlobal.mutate(action.key)}
          >
            {strings.common.run}
          </button>
        </div>
      ))}
      {list.length === 0 ? (
        <p className="row chrome text-[13px] text-ink-dim">{strings.settings.extensionNone}</p>
      ) : (
        list.map((extension) => (
          <div
            key={extension.id}
            className="row flex items-center gap-[9px]"
            style={{ opacity: extension.enabled ? 1 : 0.7 }}
          >
            <input
              type="checkbox"
              aria-label={`${extension.name} enabled`}
              checked={extension.enabled}
              onChange={(event) => update.mutate({ id: extension.id, enabled: event.target.checked })}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">
                {extension.name}
                <span className="chrome text-[12px] text-ink-dim">
                  {" \u00b7 "}
                  {strings.settings.packVersion(extension.version)}
                  {extension.author ? ` \u00b7 ${strings.settings.packBy(extension.author)}` : ""}
                  {extension.builtIn ? ` \u00b7 ${strings.settings.extensionBuiltIn}` : ""}
                </span>
              </p>
              {extension.description ? (
                <p className="chrome truncate text-[12.5px] text-ink-dim">{extension.description}</p>
              ) : null}
            </div>
            {extension.settingsSchema.length > 0 ? (
              <button
                type="button"
                className="btn flex-none px-[10px]"
                onClick={() => setSettingsFor(extension)}
              >
                {strings.settings.extensionSettings}
              </button>
            ) : null}
            {extension.builtIn ? null : (
              <button
                type="button"
                className="btn flex-none px-[10px]"
                title={strings.settings.extensionUninstallNote}
                onClick={() => {
                  if (window.confirm(strings.settings.extensionUninstallNote)) remove.mutate(extension.id);
                }}
              >
                {strings.settings.packRemove}
              </button>
            )}
          </div>
        ))
      )}

      {settingsTarget !== null && settingsTarget.settingsSchema.length > 0 ? (
        <ExtensionSettingsSheet extension={settingsTarget} onClose={() => setSettingsFor(null)} />
      ) : null}
    </section>
  );
}
