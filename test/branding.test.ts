import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness, completeSetup, type TestHarness } from "./helpers.ts";

/**
 * The app mark (SPEC §16, §20 phase 94).
 *
 * The logo ships as a built-in file, and Settings → Branding can replace it
 * with an upload or turn it off. The mark is server-owned like every other user
 * file, so this checks the endpoints and the client's read of them.
 */

let harness: TestHarness | null = null;

async function signedIn(): Promise<TestHarness> {
  if (harness === null) {
    harness = createHarness();
    await completeSetup(harness);
  }
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function send<T>(t: TestHarness, method: string, path: string, body?: unknown) {
  const response = await t.fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const parsed = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { status: response.status, body: parsed };
}

interface BrandingDto {
  showLogo: boolean;
  isCustom: boolean;
  logoUrl: string;
}

describe("the app mark", () => {
  test("ships on the built-in, shown", async () => {
    const t = await signedIn();
    const { status, body } = await send<BrandingDto>(t, "GET", "/api/branding");
    expect(status).toBe(200);
    expect(body.showLogo).toBe(true);
    expect(body.isCustom).toBe(false);
    expect(body.logoUrl).toBe("/logo.png");
  });

  test("turns off, and the toggle round-trips", async () => {
    const t = await signedIn();
    const off = await send<BrandingDto>(t, "PATCH", "/api/branding", { showLogo: false });
    expect(off.body.showLogo).toBe(false);
    const on = await send<BrandingDto>(t, "PATCH", "/api/branding", { showLogo: true });
    expect(on.body.showLogo).toBe(true);
  });

  test("an upload replaces the built-in, and the default puts it back", async () => {
    const t = await signedIn();
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "mark.png", { type: "image/png" }));

    const uploadResponse = await t.fetch("/api/branding/logo", { method: "POST", body: form });
    expect(uploadResponse.status).toBe(200);
    const uploaded = (await uploadResponse.json()) as BrandingDto;
    expect(uploaded.isCustom).toBe(true);
    expect(uploaded.logoUrl).toBe("/branding/logo");

    // The bytes serve back.
    const served = await t.fetch("/api/branding/logo");
    expect(served.status).toBe(200);
    expect(await served.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3, 4]).buffer);

    const reset = await send<BrandingDto>(t, "DELETE", "/api/branding/logo");
    expect(reset.body.isCustom).toBe(false);
    expect(reset.body.logoUrl).toBe("/logo.png");
  });

  test("rejects a non-image", async () => {
    const t = await signedIn();
    const form = new FormData();
    form.append("file", new File(["plain text"], "mark.txt", { type: "text/plain" }));
    const response = await t.fetch("/api/branding/logo", { method: "POST", body: form });
    expect(response.status).toBe(400);
  });
});

describe("the client reads the mark", () => {
  const LOGO = readFileSync(
    join(import.meta.dir, "..", "client", "components", "Logo.tsx"),
    "utf8",
  );
  const SECTION = readFileSync(
    join(import.meta.dir, "..", "client", "components", "BrandingSection.tsx"),
    "utf8",
  );

  test("the logo hides when the toggle is off", () => {
    expect(LOGO).toContain("useBranding");
    expect(LOGO).toContain("showLogo === false");
  });

  test("branding offers replace, reset and the toggle", () => {
    expect(SECTION).toContain("useUploadBrandingLogo");
    expect(SECTION).toContain("useResetBrandingLogo");
    expect(SECTION).toContain("useUpdateBranding");
  });
});
