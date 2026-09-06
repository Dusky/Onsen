import { useRef, useState } from "react";
import { strings } from "../strings.ts";
import { useSetOwnerAvatar } from "../lib/queries.ts";

/**
 * The picture for a persona or an author (SPEC §2, §20 phase 61).
 *
 * `avatar_path` has been on both tables since migration 0005 and nothing ever
 * wrote or read either one. The reason it stayed dead for fifty-odd phases is
 * worth keeping in view: a character's picture arrives inside its card, so the
 * importer covers it, and nobody ever imports the reader. These two needed an
 * upload, and an upload is a control somebody has to draw.
 *
 * One component for both, because the routes, the sizes and the lifetime are
 * identical. `kind` is a path segment out of a literal union, never a value
 * from a form.
 */
export function AvatarField({
  kind,
  id,
  name,
  hasAvatar,
}: {
  kind: "personas" | "authors";
  id: string;
  name: string;
  hasAvatar: boolean;
}) {
  const set = useSetOwnerAvatar(kind, id);
  const input = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A replaced picture keeps its URL for the length of a page — the server
  // names each upload with a fresh ULID, but the query cache is what tells this
  // component the id changed, and `hasAvatar` is a boolean either way. The
  // cache-buster is on the img, not on the record.
  const [version, setVersion] = useState(0);
  const url = hasAvatar ? `/api/${kind}/${id}/avatar?v=${version}` : null;

  return (
    <div className="mb-[12px]">
      <p className="section-label mb-[6px]">{strings.sceneSetup.personaPicture}</p>
      <div className="flex items-center gap-[10px]">
        <span
          aria-hidden="true"
          className="flex h-[44px] w-[44px] flex-none items-center justify-center rounded-full bg-bg-raised bg-cover bg-center text-[15px] text-ink-dim"
          style={url === null ? undefined : { backgroundImage: `url(${url})` }}
        >
          {name.slice(0, 1)}
        </span>
        <button
          type="button"
          className="btn flex-none"
          disabled={set.isPending}
          onClick={() => input.current?.click()}
        >
          {hasAvatar ? strings.sceneSetup.personaPictureReplace : strings.sceneSetup.personaPictureAdd}
        </button>
        {hasAvatar ? (
          <button
            type="button"
            className="btn flex-none"
            disabled={set.isPending}
            onClick={() => {
              setError(null);
              set.mutate(null, { onError: (cause) => setError(cause.message) });
            }}
          >
            {strings.sceneSetup.personaPictureRemove}
          </button>
        ) : null}
      </div>
      {error === null ? null : <p className="explain mt-[6px]">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={strings.sceneSetup.personaPicture}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file === undefined) return;
          setError(null);
          set.mutate(file, {
            onSuccess: () => setVersion((current) => current + 1),
            onError: (cause) => setError(cause.message),
          });
        }}
      />
    </div>
  );
}
