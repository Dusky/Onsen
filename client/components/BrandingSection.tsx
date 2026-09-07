import { useRef, useState } from "react";
import { strings } from "../strings.ts";
import {
  useBranding,
  useResetBrandingLogo,
  useUpdateBranding,
  useUploadBrandingLogo,
} from "../lib/queries.ts";

/**
 * The app mark (SPEC §16, §20 phase 94).
 *
 * The logo shown at the size it is read, with the two things a mark needs: a
 * way to replace it (an upload, or back to the built-in) and a way to turn it
 * off. The upload goes to the server like every other user file — nothing here
 * touches the browser's own storage.
 */
export function BrandingSection() {
  const branding = useBranding();
  const update = useUpdateBranding();
  const upload = useUploadBrandingLogo();
  const reset = useResetBrandingLogo();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const showLogo = branding.data?.showLogo ?? true;
  const logoUrl = branding.data?.logoUrl ?? "/logo.png";
  const isCustom = branding.data?.isCustom ?? false;

  return (
    <>
      <p className="group-heading mb-[12px]">{strings.settings.branding}</p>
      <p className="explain mb-[14px]">{strings.settings.brandingHint}</p>

      {/* The mark, on a panel of its own ground, at a size a reader can judge. */}
      <div className="mb-[16px] flex h-[220px] items-center justify-center border border-rule bg-bg-inset">
        <img
          src={logoUrl}
          alt=""
          className="max-h-[180px] max-w-full"
          style={{ opacity: showLogo ? 1 : 0.35 }}
        />
      </div>

      <div className="mb-[16px] flex gap-[8px]">
        <input
          ref={input}
          type="file"
          hidden
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file === undefined) return;
            setError(null);
            upload.mutate(file, {
              onError: (caught) => setError(caught.message),
            });
          }}
        />
        <button
          type="button"
          className="btn flex-1"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? strings.settings.brandingUploading : strings.settings.brandingUpload}
        </button>
        <button
          type="button"
          className="btn flex-1"
          disabled={!isCustom || reset.isPending}
          onClick={() => reset.mutate()}
        >
          {strings.settings.brandingDefault}
        </button>
      </div>

      {error === null ? null : (
        <p role="alert" className="explain explain-alert mb-[12px]">
          {error}
        </p>
      )}

      {/* Shown beside the wordmark, or the wordmark stands alone. */}
      <button
        type="button"
        aria-pressed={showLogo}
        onClick={() => update.mutate({ showLogo: !showLogo })}
        className={`btn w-full ${showLogo ? "btn-primary" : ""}`}
      >
        {showLogo ? strings.settings.brandingShown : strings.settings.brandingHidden}
      </button>
    </>
  );
}
