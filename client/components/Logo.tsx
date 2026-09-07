import { useBranding } from "../lib/queries.ts";

/**
 * The app's mark (SPEC §16, §20 phase 94): a stylised silhouette of a woman in
 * a bikini, beside the mono wordmark.
 *
 * Generated with the NanoGPT image API and flattened to one amber shape on a
 * transparent ground, it ships as `/logo.png` and can be replaced by an upload
 * or turned off from Settings → Branding. The show/hide is read here, in the
 * shell, so a toggle takes effect the moment the cache refetches.
 */
export function Logo({ className }: { className?: string }) {
  const branding = useBranding();
  if (branding.data?.showLogo === false) return null;
  return (
    <img
      src={branding.data?.logoUrl ?? "/logo.png"}
      alt=""
      aria-hidden="true"
      className={className}
    />
  );
}
