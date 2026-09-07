/**
 * The app's mark (the redesign): a stylised silhouette of a woman in a bikini.
 *
 * Generated with the NanoGPT image API and flattened to a single amber shape
 * on a transparent ground, so it sits in the chrome like the wordmark it
 * stands beside. Rendered as an image rather than an inline path because the
 * shape came from a model, not from a hand-drawn curve.
 */
export function Logo({ className }: { className?: string }) {
  return <img src="/logo.png" alt="" aria-hidden="true" className={className} />;
}
