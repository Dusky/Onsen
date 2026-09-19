import { useState } from "react";
import type { ConnectionProfileDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { useConnectionProfiles, useProviders, useScene, useUpdateScene } from "../lib/queries.ts";
import {
  ProfileFields,
  ProviderFields,
  Row,
  kindLabel,
  statusDot,
} from "./ConnectionFields.tsx";

/**
 * Models, in a rail (§20 phase 179).
 *
 * Providers lived only in Settings, which is a full-screen overlay: changing
 * what a roleplay talks to meant leaving the thing you were reading. The rail
 * keeps the quick half — which profile a roleplay is pointed at, switched in
 * one click — and the full per-scene controls (model override, provider
 * override) live in Scene Setup now (§20 phase 210), where every other
 * per-scene decision is.
 *
 * The forms are `ConnectionFields`', not this file's. A credential form is the
 * last thing that should exist twice, so the settings screen and this panel
 * render the same two components; Settings keeps its Models category because a
 * phone has no rails and removing it would strand every phone reader.
 */
/**
 * A row's accessible name, with the parts kept apart (§20 phase 226).
 *
 * A row is three stacked `<span>`s and a chevron, and an accessible name
 * computed from text content glues them: `"DeepSeekOpenAI-compatible · keyed›"`
 * is what a screen reader read out, with the provider's name run into its kind
 * and the disclosure arrow on the end. Phase 190 fixed this class in the header,
 * where the controls were icon-only; its sweep did not reach a list whose
 * buttons have text.
 *
 * Naming the parts explicitly also drops the chevron, which is a state the
 * button already carries in `aria-expanded` and has no business saying twice.
 */
function rowName(...parts: (string | null | undefined)[]): string {
  return parts.filter((part) => part !== null && part !== undefined && part !== "").join(", ");
}

export function ModelsPanel({ sceneId }: { sceneId: string | null }) {
  const providers = useProviders();
  const profiles = useConnectionProfiles();
  // Only the scene's own row, and only to read which profile it points at.
  // `1` because the messages are irrelevant here and a window of them is not.
  //
  // Disabled without a scene (§20 phase 226): the `?? ""` fallback was being
  // fetched, so every render of this panel off a roleplay asked the server for
  // `/api/scenes/?limit=1` and took a 404 for it. Found in the console while
  // driving the settings filter, which is a panel away from here.
  const scene = useScene(sceneId ?? "", 1, sceneId !== null);
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
                aria-label={rowName(profile.name, byId.get(profile.providerId)?.name, profile.model)}
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
                  <span className="block truncate text-ui-loose font-medium">{profile.name}</span>
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

      {/* Provider and model for this roleplay moved to Scene Setup (§20 phase
          210), so the rail keeps only the quick switch above and the
          management lists below. */}

      <p className="section-label mb-[6px]">{strings.settings.providers}</p>
      {providerList.map((provider) => {
        const isOpen = editingProvider === provider.id;
        return (
          <Row key={provider.id}>
            <button
              type="button"
              onClick={() => setEditingProvider(isOpen ? undefined : provider.id)}
              aria-expanded={isOpen}
              aria-label={rowName(
                provider.name,
                kindLabel(provider.kind),
                provider.hasApiKey ? strings.models.keyed : null,
              )}
              className="tap flex w-full gap-[9px] text-left"
            >
              {statusDot(provider.enabled && provider.baseUrl !== null)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-loose font-medium">{provider.name}</span>
                <span className="meta block truncate">
                  {[kindLabel(provider.kind), provider.hasApiKey ? strings.models.keyed : null]
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
              aria-label={rowName(
                profile.name,
                byId.get(profile.providerId)?.name,
                profile.model,
                profile.isDefault ? strings.settings.profileDefault : null,
              )}
              className="tap flex w-full items-baseline gap-[9px] text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-loose font-medium">{profile.name}</span>
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
