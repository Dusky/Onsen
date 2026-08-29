import { useState } from "react";
import { Screen } from "../components/Screen.tsx";
import { Field } from "../components/Field.tsx";
import { Notice } from "../components/Notice.tsx";
import { strings } from "../strings.ts";
import { api, ApiRequestError } from "../lib/api.ts";
import type { LoginRequest } from "@shared/types.ts";

const s = strings.login;

export function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post<{ ok: true }>("/auth/login", { password } satisfies LoginRequest);
      onAuthenticated();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : strings.errors.unexpected);
      setSubmitting(false);
      setPassword("");
    }
  }

  return (
    <Screen kicker={s.kicker} title={s.title}>
      <form onSubmit={submit}>
        {error ? <Notice>{error}</Notice> : null}
        <Field label={s.passwordLabel}>
          {(id) => (
            <input
              id={id}
              className="field"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={submitting || password === ""}
        >
          {submitting ? s.submitting : s.submit}
        </button>
      </form>
    </Screen>
  );
}
