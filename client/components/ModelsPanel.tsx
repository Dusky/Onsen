import { useRef, useState } from "react";
import type { ConnectionProfileDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import {
  useConnectionProfiles,
  useProviders,
  useScene,
  useUpdateScene,
} from "../lib/queries.ts";
import {
  ProfileFields,
  ProviderFields,
  Row,
  kindLabel,
  statusDot,
} from "./ConnectionFields.tsx";
import { ModelPicker } from "./ModelPicker.tsx";

/**
 * Models, in a rail (§20 phase 179).
 *
 * Providers lived only in Settings, which is a full-screen overlay: changing
 * what a roleplay talks to meant leaving the thing you were reading, finding
 * the Models category, scrolling, expanding a row, and scrolling again to
 * reach a Save button that sat below the fold. The report was that this needs
 * to be faster and that it should be a rail activity, which is right — a
 * provider is machinery, and the left rail is where this app keeps machinery.
 *
 * Three things in one panel, because the request named three verbs:
 *
 *   - **changing** — what this roleplay is pointed at, switched in one click;
 *   - **editing** — the provider and profile rows, expanded in place;
 *   - **managing** — adding and removing either.
 *
 * The forms are `ConnectionFields`', not this file's. A credential form is the
 * last thing that should exist twice, so the settings screen and this panel
 * render the same two components; Settings keeps its Models category because a
 * phone has no rails and removing it would strand every phone reader.
 */
export function ModelsPanel({ sceneId }: { sceneId: string | null }) {
  const providers = useProviders();
  const profiles = useConnectionProfiles();
  // Only the scene's own row, and only to read which profile it points at.
  // `1` because the messages are irrelevant here and a window of them is not.
  const scene = useScene(sceneId ?? "", 1);
  const updateScene = useUpdateScene(sceneId ?? "");

  /** `undefined` closed, `null` the add form, an id the row being edited. */
  const [editingProvider, setEditingProvider] = useState<string | null | undefined>(undefined);
  const [editingProfile, setEditingProfile] = useState<ConnectionProfileDto | null | undefined>(
    undefined,
  );

  const providerList = providers.data ?? [];
  const profileList = profiles.data ?? [];
  const byId = new Map(providerList.map((provider) => [provider.id, provider]));
  const activeId = scene.data?.scene.connectionProfileId ?? null;

  /*
   * Which model this roleplay actually runs on, and where that came from
   * (§20 phase 180).
   *
   * The chain the server resolves is scene, then profile, then provider
   * (`server/generation/route.ts`), so the panel shows the same three in the
   * same order — a picker that displayed the profile's model while the turn
   * used the scene's would be worse than no picker.
   */
  const activeProfile = profileList.find((profile) => profile.id === activeId) ?? null;
  const activeProvider =
    activeProfile === null ? null : (byId.get(activeProfile.providerId) ?? null);
  const inherited = activeProfile?.model ?? activeProvider?.model ?? null;
  const sceneModel = scene.data?.scene.model ?? null;
  const modelRef = useRef<HTMLInputElement>(null);

  return (
    <div className="pt-[12px] pb-[16px]">
      {/* What this roleplay answers with, and the one click that changes it.
          This is the half that used to be a bottom sheet off the status bar:
          a flat list of names, with no model shown and no mark on the one in
          force. */}
      <p className="section-label mb-[6px]">{strings.models.inUse}</p>
      {sceneId === null ? (
        <p className="explain mb-[18px]">{strings.models.noScene}</p>
      ) : profileList.length === 0 ? (
        <p className="explain mb-[18px]">{strings.chat.noProfiles}</p>
      ) : (
        <div className="mb-[18px]">
          {profileList.map((profile) => {
            const on = profile.id === activeId;
            return (
              <button
                key={profile.id}
                type="button"
                aria-current={on ? "true" : undefined}
                disabled={on || updateScene.isPending}
                onClick={() => updateScene.mutate({ connectionProfileId: profile.id })}
                className="tap flex w-full items-baseline gap-[8px] border-b border-rule py-[8px] text-left"
              >
                <span
                  className="chrome flex-none text-[12px]"
                  style={{
                    color: on ? "var(--onsen-color-blue)" : "var(--onsen-color-border-quiet)",
                  }}
                >
                  {on ? "●" : "○"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{profile.name}</span>
                  {/* The model, which the old picker never showed — the whole
                      question being answered here is "which model", and a
                      list of profile names does not answer it. */}
                  <span className="meta block truncate">
                    {[byId.get(profile.providerId)?.name, profile.model]
                      .filter((part) => part !== undefined && part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Changing the model, not only reading it. Editing the profile would
          change every roleplay pointed at it; this belongs to one. */}
      {sceneId === null || activeProfile === null ? null : (
        <div className="mb-[18px]">
          <p className="section-label mb-[6px]">{strings.models.modelLabel}</p>
          <ModelPicker
            request={() => ({
              // Spread rather than an undefined-valued key: the project runs
              // `exactOptionalPropertyTypes`, so an absent option and one set
              // to `undefined` are different types.
              ...(activeProvider === null ? {} : { kind: activeProvider.kind, providerId: activeProvider.id }),
              baseUrl: activeProvider?.baseUrl ?? "",
            })}
            selected={sceneModel ?? inherited ?? ""}
            emptyMessage={strings.models.modelNoAddress}
            onPick={(model) => {
              if (modelRef.current !== null) modelRef.current.value = model;
              updateScene.mutate({ model });
            }}
          >
            <input
              ref={modelRef}
              className="field min-w-0 flex-1"
              aria-label={strings.models.modelLabel}
              // Keyed on what is in force, so switching profiles or clearing
              // the override re-seeds the box rather than stranding old text.
              key={sceneModel ?? inherited ?? ""}
              defaultValue={sceneModel ?? inherited ?? ""}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next === (sceneModel ?? "")) return;
                updateScene.mutate({ model: next });
              }}
            />
          </ModelPicker>
          <p className="explain mt-[6px]">
            {sceneModel === null
              ? inherited === null
                ? strings.models.modelNoAddress
                : strings.models.modelFromProfile(inherited)
              : ""}
          </p>
          {sceneModel === null ? null : (
            <button
              type="button"
              className="btn w-full"
              onClick={() => updateScene.mutate({ model: null })}
            >
              {strings.models.modelClear}
            </button>
          )}
        </div>
      )}

      <p className="section-label mb-[6px]">{strings.settings.providers}</p>
      {providerList.map((provider) => {
        const isOpen = editingProvider === provider.id;
        return (
          <Row key={provider.id}>
            <button
              type="button"
              onClick={() => setEditingProvider(isOpen ? undefined : provider.id)}
              aria-expanded={isOpen}
              className="tap flex w-full gap-[9px] text-left"
            >
              {statusDot(provider.enabled && provider.baseUrl !== null)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{provider.name}</span>
                <span className="meta block truncate">
                  {[provider.model, kindLabel(provider.kind), provider.hasApiKey ? "keyed" : null]
                    .filter((part) => part !== null && part !== "")
                    .join(" · ")}
                </span>
              </span>
              <span className="chrome flex-none self-center text-[12px] text-ink-dim">
                {isOpen ? "▾" : "›"}
              </span>
            </button>
            {isOpen ? (
              <div className="mt-[12px] border-t border-rule pt-[12px]">
                <ProviderFields
                  provider={provider}
                  onClose={() => setEditingProvider(undefined)}
                />
              </div>
            ) : null}
          </Row>
        );
      })}
      {editingProvider === null ? (
        <div className="mt-[10px] mb-[18px] border-t border-rule pt-[12px]">
          <ProviderFields provider={null} onClose={() => setEditingProvider(undefined)} />
        </div>
      ) : (
        <button
          type="button"
          className="btn mt-[10px] mb-[18px] w-full"
          onClick={() => setEditingProvider(null)}
        >
          {strings.models.addProvider}
        </button>
      )}

      <p className="section-label mb-[6px]">{strings.settings.profiles}</p>
      {profileList.map((profile) => {
        const isOpen = editingProfile?.id === profile.id;
        return (
          <Row key={profile.id}>
            <button
              type="button"
              onClick={() => setEditingProfile(isOpen ? undefined : profile)}
              aria-expanded={isOpen}
              className="tap flex w-full items-baseline gap-[9px] text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{profile.name}</span>
                <span className="meta block truncate">
                  {[byId.get(profile.providerId)?.name, profile.model]
                    .filter((part) => part !== undefined && part !== null && part !== "")
                    .join(" · ")}
                </span>
              </span>
              {profile.isDefault ? (
                <span
                  className="chrome flex-none text-[12px]"
                  style={{ color: "var(--onsen-color-amber)" }}
                >
                  {strings.settings.profileDefault}
                </span>
              ) : null}
              <span className="chrome flex-none self-center text-[12px] text-ink-dim">
                {isOpen ? "▾" : "›"}
              </span>
            </button>
            {isOpen ? (
              <div className="mt-[12px] border-t border-rule pt-[12px]">
                <ProfileFields
                  profile={profile}
                  providers={providerList}
                  onClose={() => setEditingProfile(undefined)}
                />
              </div>
            ) : null}
          </Row>
        );
      })}
      {editingProfile === null ? (
        <div className="mt-[10px] border-t border-rule pt-[12px]">
          <ProfileFields
            profile={null}
            providers={providerList}
            onClose={() => setEditingProfile(undefined)}
          />
        </div>
      ) : (
        <button
          type="button"
          className="btn mt-[10px] w-full"
          onClick={() => setEditingProfile(null)}
        >
          {strings.models.addProfile}
        </button>
      )}
    </div>
  );
}
