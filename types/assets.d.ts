/**
 * SQL migrations are imported as text (`with { type: "text" }`) so that
 * `bun build --compile` embeds them in the single-file executable rather than
 * reading them from a directory that will not exist at runtime.
 */
declare module "*.sql" {
  const contents: string;
  export default contents;
}

declare module "*.css";
