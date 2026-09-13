import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { chatPathFor, joinUrl, providerErrorMessage } from "../server/adapters/errors.ts";
import { PROVIDER_PRESETS } from "../shared/providers.ts";

/**
 * What a provider said, and whether we asked it the right question
 * (§20 phase 182).
 *
 * This phase started from one report — "deepseek is failing even tho i am
 * using a valid api", with the error cut off mid-word at
 * `The supported API model n` — and the report turned out to name two
 * separate defects with one cause between them: **the Test button did not ask
 * what a turn asks.** It posted no model at all, built its Anthropic URL from
 * its own copy of the path, and showed whatever came back as raw JSON clipped
 * at 200 characters.
 *
 * So the guards here are mostly about *agreement*: between the four copies of
 * the error parser, between the Test button's URL and the adapter's, between
 * the Test button's body and the adapter's. A check that asks a different
 * question than the real thing can pass while the app is broken — which is
 * exactly what the Anthropic preset did, and it is the same family as a status
 * readout that disagrees with the turn (§20 phase 181).
 */

const ADAPTER_DIR = "server/adapters";
const CONNECTIONS = readFileSync("server/routes/connections.ts", "utf8");
const FIELDS = readFileSync("client/components/ConnectionFields.tsx", "utf8");
const ERRORS = readFileSync(`${ADAPTER_DIR}/errors.ts`, "utf8");

/**
 * The same source with its comments removed.
 *
 * Needed because several guards here are "this path is never built by hand",
 * and the files explain *why* by quoting the wrong path they used to build.
 * A sweep that reads prose as code fails on its own explanation — which has
 * now happened twice in this project, and the fix both times is to make the
 * assertion mean what it says rather than to stop writing the comment.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every adapter, read as text — a sweep, so a new one cannot slip the net. */
const ADAPTERS = readdirSync(ADAPTER_DIR)
  .filter((name) => name.endsWith(".ts") && name !== "errors.ts")
  .map((name) => ({ name, source: readFileSync(`${ADAPTER_DIR}/${name}`, "utf8") }));

describe("one parser, not four", () => {
  test("no adapter keeps its own copy of the helpers", () => {
    // A sweep of the directory rather than a list of the three files this was
    // written against: the whole point is that a fourth adapter, added later,
    // cannot quietly reintroduce the thing that was just deleted.
    for (const { name, source } of ADAPTERS) {
      expect(`${name}: ${source.includes("function readErrorBody")}`).toBe(`${name}: false`);
      expect(`${name}: ${source.includes("function joinUrl")}`).toBe(`${name}: false`);
    }
  });

  test("every adapter that reports a failure imports the shared one", () => {
    for (const { name, source } of ADAPTERS) {
      if (!source.includes("readErrorBody")) continue;
      expect(`${name}: ${source.includes('from "./errors.ts"')}`).toBe(`${name}: true`);
    }
  });

  test("the sentence comes out, whatever envelope it arrived in", () => {
    // Executed, not read as text: this is real parsing and the shapes are the
    // ones providers actually send.
    expect(providerErrorMessage('{"error":{"message":"The supported API models are x, y"}}')).toBe(
      "The supported API models are x, y",
    );
    expect(providerErrorMessage('{"error":"flat string"}')).toBe("flat string");
    expect(providerErrorMessage('{"message":"top level"}')).toBe("top level");
    expect(providerErrorMessage('{"detail":"fastapi says"}')).toBe("fastapi says");
    expect(providerErrorMessage("")).toBe(null);
    // Not JSON at all: an HTML error page from a proxy is still the most
    // useful thing to show, so it survives rather than becoming null.
    expect(providerErrorMessage("<html>502 Bad Gateway</html>")).toBe("<html>502 Bad Gateway</html>");
  });

  test("an unparseable body keeps far more than a line", () => {
    // The reported failure was a useful sentence cut off at 200 characters.
    // Whatever the cap is, it is generous, and the panel wraps rather than
    // clipping.
    const long = "x".repeat(5000);
    expect(providerErrorMessage(long)!.length).toBeGreaterThan(1000);
  });
});

describe("the test asks what the turn asks", () => {
  test("one function owns each kind's chat path", () => {
    expect(chatPathFor("anthropic")).toBe("v1/messages");
    expect(chatPathFor("text_completion")).toBe("completions");
    expect(chatPathFor("openai_compatible")).toBe("chat/completions");
    // An unknown kind falls to the shape almost everything speaks, rather
    // than throwing at generation time.
    expect(chatPathFor("something_new")).toBe("chat/completions");
  });

  test("the Test button derives its URL from that same function", () => {
    // The defect: this built `/messages` for Anthropic while the adapter
    // appends `v1/messages`, so an address ending in `/v1` passed the test
    // and 404'd at `…/v1/v1/messages` on every real turn.
    expect(CONNECTIONS).toContain("joinUrl(input.baseUrl, chatPathFor(input.kind))");
    const code = codeOf(CONNECTIONS);
    expect(code).not.toMatch(/["'`]\/?messages["'`]/);
    expect(code).not.toMatch(/["'`]\/?chat\/completions["'`]/);
  });

  test("each adapter derives its chat URL from it too", () => {
    for (const { name, source } of ADAPTERS) {
      if (!source.includes("chatPathFor")) continue;
      expect(`${name}: ${/joinUrl\(config\.baseUrl, chatPathFor\(/.test(source)}`).toBe(
        `${name}: true`,
      );
    }
  });

  test("joining does not double or drop the separator", () => {
    expect(joinUrl("https://api.deepseek.com/v1", "chat/completions")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
    expect(joinUrl("https://api.deepseek.com/v1/", "/chat/completions")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
    expect(joinUrl("https://api.anthropic.com", "v1/messages")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });

  test("the test names a model, because every adapter does", () => {
    /*
     * The reported bug, at its root. `modelRequest()` is the *model list*
     * request and correctly carries no model — asking a provider what it
     * serves cannot name one. Test reused it verbatim, so every test posted
     * `model: ""`, and DeepSeek answered with a 400 listing what it does
     * serve. The reader read that as their key being rejected, with the model
     * they had just fetched sitting in the box above.
     */
    expect(FIELDS).toContain("function testRequest()");
    expect(FIELDS).toMatch(/testRequest\(\)[\s\S]{0,400}model: String\(data\.get\("model"\)/);
    expect(FIELDS).toContain("test.mutate(testRequest()");
    /*
     * And the model *list* request still does not carry one — pinned at the
     * type level rather than by proximity in the component, because that is
     * where it is actually true: asking a provider what it serves is a
     * question that cannot name a model, and the two requests differing is
     * the whole reason Test needs its own builder.
     */
    const queries = readFileSync("client/lib/queries.ts", "utf8");
    const fetchModels = queries.slice(queries.indexOf("export function useFetchModels()"));
    expect(fetchModels.slice(0, 300)).not.toContain("model:");
    const testConnection = queries.slice(queries.indexOf("export function useTestConnection()"));
    expect(testConnection.slice(0, 300)).toContain("model?: string;");
  });

  test("no model is refused in our own words, not the provider's", () => {
    // A turn with no model throws `no_model` before any adapter is reached,
    // so a test with no model is testing something that cannot happen.
    expect(CONNECTIONS).toMatch(/input\.model === null \|\| input\.model === ""/);
    expect(CONNECTIONS).toContain("Name a model first");
    // Never send an empty one and relay the blame.
    expect(CONNECTIONS).not.toContain('model: input.model ?? ""');
  });

  test("the text-completion body names a model too", () => {
    // It did not, while `text.ts` sends `model: config.model` — a third way
    // the test differed from the turn.
    expect(CONNECTIONS).toMatch(/text_completion[\s\S]{0,200}model: input\.model/);
  });
});

describe("a preset names an address and nothing more", () => {
  test("no preset carries a model id", () => {
    // Shipped ones went stale within days: a reader picked DeepSeek, kept the
    // prefilled model, and got a 400 from an endpoint their key was fine for.
    // Fetch asks the provider what it serves *now*, which cannot go stale.
    for (const preset of PROVIDER_PRESETS) {
      expect(`${preset.key}: ${"models" in preset}`).toBe(`${preset.key}: false`);
      expect(`${preset.key}: ${"model" in preset}`).toBe(`${preset.key}: false`);
    }
    expect(readFileSync("shared/providers.ts", "utf8")).not.toContain("models:");
  });

  test("picking a preset clears whatever model was in the box", () => {
    expect(FIELDS).toMatch(/modelRef\.current !== null\) modelRef\.current\.value = ""/);
  });

  test("every address agrees with its kind's path convention", () => {
    /*
     * The rule `chatPathFor` imposes, asserted against all 17 presets rather
     * than the one that was wrong. Anthropic's shipped as
     * `https://api.anthropic.com/v1` and would have 404'd every turn.
     */
    for (const preset of PROVIDER_PRESETS) {
      const path = chatPathFor(preset.kind);
      const supplies = path.startsWith("v1/");
      // If the adapter supplies `/v1`, the address must not end in one.
      expect(`${preset.key}: ${supplies && /\/v1\/?$/.test(preset.baseUrl)}`).toBe(
        `${preset.key}: false`,
      );
      // And a joined URL never contains a doubled version segment.
      expect(`${preset.key}: ${joinUrl(preset.baseUrl, path)}`).not.toContain("/v1/v1/");
    }
  });

  test("no preset carries a key, and every one is reachable by the picker", () => {
    const keys = new Set<string>();
    for (const preset of PROVIDER_PRESETS) {
      expect(`${preset.key}: ${"apiKey" in preset}`).toBe(`${preset.key}: false`);
      expect(preset.baseUrl).toMatch(/^https?:\/\//);
      expect(["hosted", "local"]).toContain(preset.where);
      expect(keys.has(preset.key)).toBe(false);
      keys.add(preset.key);
    }
    // The five the request named by name, so none can quietly go missing.
    for (const required of ["deepseek", "anthropic", "openai", "nanogpt", "zai"]) {
      expect(keys.has(required)).toBe(true);
    }
  });
});

describe("the reader can read what went wrong", () => {
  test("the result wraps and is selectable, not truncated to one line", () => {
    // It sat in a `truncate` span beside the button, so a 400 explaining
    // exactly which models an endpoint serves was clipped mid-word.
    expect(FIELDS).toMatch(/testResult === null \? null : \([\s\S]{0,400}whitespace-pre-wrap/);
    expect(FIELDS).toMatch(/testResult === null \? null : \([\s\S]{0,400}select-all/);
    expect(FIELDS).not.toMatch(/testResult === null \? null : \([\s\S]{0,400}truncate/);
  });

  test("the failure carries the provider's sentence, not its envelope", () => {
    expect(CONNECTIONS).toContain("providerErrorMessage(await response.text())");
    expect(ERRORS).toContain("export function providerErrorMessage(");
    // The old shape: raw body, clipped at 200.
    expect(CONNECTIONS).not.toMatch(/\.slice\(0, 200\)/);
  });
});
