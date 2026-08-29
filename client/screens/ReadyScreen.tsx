import { useEffect, useState } from "react";
import { Screen } from "../components/Screen.tsx";
import { strings } from "../strings.ts";
import { api } from "../lib/api.ts";
import type { ConnectionProfileDto } from "@shared/types.ts";

const s = strings.home;

/**
 * A holding screen for the end of phase 1: it proves the server is configured
 * and the session works. The chat screen (SPEC §20 phase 5) replaces it.
 */
export function ReadyScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const [profiles, setProfiles] = useState<ConnectionProfileDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<ConnectionProfileDto[]>("/connections/profiles")
      .then((list) => {
        if (!cancelled) setProfiles(list);
      })
      .catch(() => {
        /* The screen is still meaningful without the list. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await api.post("/auth/logout");
    onSignedOut();
  }

  return (
    <Screen kicker={s.kicker} title={s.title}>
      <p className="mb-[26px] text-[var(--onsen-text-prose-excerpt)] leading-[1.55] text-ink-prose-muted">
        {s.body}
      </p>

      <h2 className="section-label mb-[2px] border-b border-rule pb-[8px]">
        {s.connectionsLabel}
      </h2>
      <ul className="mb-[26px]">
        {profiles.map((profile) => (
          <li
            key={profile.id}
            className="flex items-baseline justify-between gap-[12px] border-b border-rule py-[13px]"
          >
            <span className="text-[15px] font-medium">{profile.name}</span>
            <span className="chrome text-[9px] tracking-[0.08em] text-ink-dim uppercase">
              {profile.model ?? "—"}
            </span>
          </li>
        ))}
      </ul>

      <button type="button" className="btn" onClick={() => void signOut()}>
        {s.signOut}
      </button>
    </Screen>
  );
}
