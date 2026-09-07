import { createExtensionApi, type ExtensionRegistration } from "./api.ts";

/**
 * Load an extension's server module and collect what it registers (§20
 * phase 110).
 *
 * The module is imported by path — Bun transpiles TypeScript on the way in —
 * and its `register` export (or default export's `register`) is called with a
 * collecting API. A module with no `register` is a data-only extension and
 * registers nothing.
 */
export async function loadExtensionModule(
  path: string,
  name: string,
): Promise<ExtensionRegistration> {
  const { api, registration } = createExtensionApi(name);
  // A cache-busting query so a reinstalled extension reloads, not a stale copy.
  const loaded = (await import(`${path}?t=${Date.now()}`)) as Record<string, unknown>;
  const register = loaded["register"] ?? (loaded["default"] as Record<string, unknown> | undefined)?.["register"];
  if (typeof register === "function") {
    await (register as (api: unknown) => void | Promise<void>)(api);
  }
  return registration;
}
