import { useState } from "react";
import { Screen } from "../components/Screen.tsx";
import { Field } from "../components/Field.tsx";
import { Notice } from "../components/Notice.tsx";
import { strings } from "../strings.ts";
import { ModelPicker } from "../components/ModelPicker.tsx";
import { api, ApiRequestError } from "../lib/api.ts";
import {
  MIN_PASSWORD_LENGTH,
  PROVIDER_KINDS,
  type ProviderKind,
  type SetupRequest,
  type SetupResponse,
} from "@shared/types.ts";

const s = strings.setup;

function baseUrlPlaceholder(kind: ProviderKind): string {
  return kind === "text_completion" ? s.baseUrlPlaceholderLocal : s.baseUrlPlaceholderOpenAi;
}

/**
 * First boot (SPEC §17): one password and one connection profile. Nothing else
 * is asked for — everything the app can do is configurable later, and a wizard
 * that demands decisions before the user has seen the product is the density
 * problem this project is reacting against.
 */
export function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [kind, setKind] = useState<ProviderKind>("openai_compatible");
  const [providerName, setProviderName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [profileName, setProfileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordLongEnough = password.length >= MIN_PASSWORD_LENGTH;
  const passwordsMatch = confirm === password;
  const canSubmit =
    passwordLongEnough && passwordsMatch && providerName.trim() !== "" && !submitting;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    const body: SetupRequest = {
      password,
      connection: {
        profileName: profileName.trim() || providerName.trim(),
        providerName: providerName.trim(),
        kind,
        ...(baseUrl.trim() === "" ? {} : { baseUrl: baseUrl.trim() }),
        ...(apiKey.trim() === "" ? {} : { apiKey: apiKey.trim() }),
        ...(model.trim() === "" ? {} : { model: model.trim() }),
      },
    };

    try {
      await api.post<SetupResponse>("/setup", body);
      onComplete();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : strings.errors.unexpected,
      );
      setSubmitting(false);
    }
  }

  return (
    <Screen kicker={s.kicker} title={s.title}>
      <form onSubmit={submit} noValidate>
        {error ? <Notice>{error}</Notice> : null}

        <h2 className="section-label mb-[14px] border-b border-rule pb-[8px]">
          {s.passwordSection}
        </h2>

        <Field label={s.passwordLabel}>
          {(id) => (
            <input
              id={id}
              className="field"
              type="password"
              autoComplete="new-password"
              placeholder={s.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        <Field
          label={s.passwordConfirmLabel}
          hint={confirm !== "" && !passwordsMatch ? s.passwordMismatch : s.passwordHint}
        >
          {(id) => (
            <input
              id={id}
              className="field"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>

        <h2 className="section-label mt-[28px] mb-[14px] border-b border-rule pb-[8px]">
          {s.connectionSection}
        </h2>

        <Field label={s.providerKindLabel} hint={strings.providerKindHint[kind]}>
          {(id) => (
            <div id={id} className="flex flex-wrap gap-[6px]" role="radiogroup">
              {PROVIDER_KINDS.map((option) => {
                const active = option === kind;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setKind(option)}
                    className={`btn ${active ? "btn-primary" : ""}`}
                  >
                    {strings.providerKind[option]}
                  </button>
                );
              })}
            </div>
          )}
        </Field>

        <Field label={s.providerNameLabel}>
          {(id) => (
            <input
              id={id}
              className="field"
              placeholder={s.providerNamePlaceholder}
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
            />
          )}
        </Field>

        <Field
          label={s.baseUrlLabel}
          aux={kind === "text_completion" ? undefined : strings.common.optional}
        >
          {(id) => (
            <input
              id={id}
              className="field"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={baseUrlPlaceholder(kind)}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          )}
        </Field>

        <Field label={s.apiKeyLabel} aux={strings.common.optional}>
          {(id) => (
            <input
              id={id}
              className="field"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          )}
        </Field>

        {/* The wizard is where somebody meets this app for the first time, and
            "what do I put in the model box" is the question it most needs to
            answer. It had no fetch at all until phase 49. */}
        <Field label={s.modelLabel} aux={strings.common.optional}>
          {(id) => (
            <ModelPicker
              request={() => ({ kind, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() })}
              selected={model}
              onPick={setModel}
            >
              <input
                id={id}
                className="field min-w-0 flex-1"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={s.modelPlaceholder}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </ModelPicker>
          )}
        </Field>

        <Field label={s.profileNameLabel} aux={strings.common.optional}>
          {(id) => (
            <input
              id={id}
              className="field"
              placeholder={providerName.trim()}
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
          )}
        </Field>

        <button type="submit" className="btn btn-primary mt-[10px] w-full" disabled={!canSubmit}>
          {submitting ? s.submitting : s.submit}
        </button>
      </form>
    </Screen>
  );
}
