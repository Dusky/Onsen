import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DOCK_DEFAULTS, DOCK_PANELS } from "@shared/types.ts";

/**
 * Models is a rail activity (§20 phase 179).
 *
 * Providers lived only in Settings, which is a full-screen overlay: pointing a
 * roleplay at a different model meant leaving what you were reading, finding
 * the Models category, expanding a row, and scrolling to a Save button that
 * sat below the fold. Measured before the change: the provider form is 606px
 * tall and its bottom sat at 998px of a 950px window.
 *
 * The report was that this should be faster and should be a sidebar activity,
 * and it named three verbs — managing, changing, editing — so the panel does
 * all three: the scene's own selection switched in one click, the provider and
 * profile rows expanded in place, and adding or removing either.
 */

const ROOT = join(import.meta.dir, "..");
const COMPONENTS = join(ROOT, "client", "components");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const PANEL = read("client", "components", "ModelsPanel.tsx");
const FIELDS = read("client", "components", "ConnectionFields.tsx");
const SETTINGS = read("client", "screens", "SettingsScreen.tsx");
const REGISTRY = read("client", "components", "DockPanels.tsx");
const QUERIES = read("client", "lib", "queries.ts");
const CONNECTIONS = read("server", "routes", "connections.ts");

describe("it is a dock panel like any other", () => {
  test("the union and the shipped default name it", () => {
    expect(DOCK_PANELS).toContain("models");
    // The left rail is the machinery side, and `models` sits next to `preset`:
    // which model, and how it is sampled.
    expect(DOCK_DEFAULTS.left).toEqual(["prompt", "preset", "models", "lore", "guides"]);
    expect(DOCK_DEFAULTS.left.indexOf("models")).toBe(
      DOCK_DEFAULTS.left.indexOf("preset") + 1,
    );
  });

  test("so it can be moved or hidden without a special case", () => {
    expect(REGISTRY).toContain("Component: ModelsPanel");
    for (const file of ["LeftRail.tsx", "RightRail.tsx"]) {
      expect(read("client", "components", file)).not.toContain('"models"');
    }
  });

  test("it is a plain function of the scene id, needing no slot", () => {
    // Unlike `scene` and `ooc`: everything here is server state the panel can
    // fetch for itself, so there is no node for `ChatScreen` to fill.
    expect(PANEL).toContain("export function ModelsPanel({ sceneId }");
    expect(read("client", "state", "ui.ts")).not.toContain("modelsPanel");
  });
});

describe("the credential form exists once", () => {
  test("lifted out of the settings screen, not copied into the panel", () => {
    expect(FIELDS).toContain("export function ProviderFields");
    expect(FIELDS).toContain("export function ProfileFields");
    expect(PANEL).toContain('from "./ConnectionFields.tsx"');
    expect(SETTINGS).toContain('from "../components/ConnectionFields.tsx"');
  });

  test("and no other file writes a chat provider", () => {
    /*
     * The sweep rather than a named assertion, the lesson of phases 176 and
     * 177: a credential form copied into a second host is the failure that
     * would not announce itself, and naming the files that may hold one only
     * catches the copy somebody remembered to declare.
     *
     * Narrowed to the mutations rather than to `name="apiKey"`, because the
     * first version of this test was wrong: media services and the embeddings
     * provider each have their own key field, legitimately, so a key field is
     * not the thing that may only exist once. Writing a *chat provider* is.
     */
    const writers: string[] = [];
    for (const dir of [
      ["client", "components"],
      ["client", "screens"],
    ]) {
      for (const name of readdirSync(join(ROOT, ...dir))) {
        if (!name.endsWith(".tsx")) continue;
        const source = read(...dir, name);
        if (/useCreateProvider|useUpdateProvider/.test(source)) writers.push(name);
      }
    }
    expect(writers.sort()).toEqual(["ConnectionFields.tsx"]);
  });

  test("and the extraction left no dead imports behind", () => {
    // Moving 489 lines out took seven query hooks and three components with
    // it; the imports stayed until this test went looking.
    for (const dead of [
      "useCreateProvider",
      "useUpdateProvider",
      "useTestProvider",
      "PROVIDER_KINDS",
      "InstructPicker",
      "ModelPicker",
      "useConfirm",
    ]) {
      expect(SETTINGS).not.toContain(dead);
    }
  });
});

describe("changing what a roleplay answers with", () => {
  test("every profile is one click, and the one in force is marked", () => {
    expect(PANEL).toContain("updateScene.mutate({ connectionProfileId: profile.id })");
    expect(PANEL).toContain("const on = profile.id === activeId;");
    expect(PANEL).toContain('aria-current={on ? "true" : undefined}');
    // Disabled on the one already selected: a click that does nothing should
    // not look like a click that does something.
    expect(PANEL).toContain("disabled={on || updateScene.isPending}");
  });

  test("each row says which model, which the old picker never did", () => {
    // The sheet this replaces listed profile *names* only, while the question
    // being answered is "which model".
    expect(PANEL).toContain("byId.get(profile.providerId)?.name, profile.model");
  });

  test("and it explains itself with no roleplay open", () => {
    expect(PANEL).toContain("strings.models.noScene");
  });
});

describe("a provider can be tested before it is saved", () => {
  test("the server takes values, not only a saved row", () => {
    // One helper, two doors — the shape `POST /providers/models` has used for
    // unsaved credentials since §16.
    expect(CONNECTIONS).toContain("async function probeProvider(");
    expect(CONNECTIONS).toContain('app.post("/providers/:id/test"');
    expect(CONNECTIONS).toContain('app.post("/providers/test"');
    // A stored key stands in for one the reader left blank.
    expect(CONNECTIONS).toMatch(/providers\/test[\s\S]{0,900}api_key_encrypted/);
  });

  test("the client sends the form, so the button needs no id", () => {
    expect(QUERIES).toContain("export function useTestConnection()");
    expect(FIELDS).toContain("const test = useTestConnection();");
    expect(FIELDS).toContain("test.mutate(testRequest()");
    // The old gate: Test used to be hidden until the provider existed.
    expect(FIELDS).not.toContain("{provider !== null ? (\n          <div className=\"mb-[10px] flex");
  });
});

describe("Save means save, and can be reached", () => {
  test("one sticky action row, shared by both forms", () => {
    // The provider form measured 606px with its bottom at 998px of a 950px
    // window, so Save was below the fold before a 326px rail made it worse.
    expect(FIELDS).toContain("function ActionRow(");
    expect(FIELDS).toContain("sticky bottom-[-1px]");
    expect(FIELDS.match(/<ActionRow/g)).toHaveLength(2);
    // And exactly one submit button per form, in that row.
    expect(FIELDS.match(/type="submit"/g)).toHaveLength(1);
  });

  test("prefill and the instruct template wait for the submit", () => {
    /*
     * They used to write to the server the moment they were clicked, while
     * every other field waited for Save — so Save saved part of the form, and
     * closing without saving had already stored half the edit.
     */
    expect(FIELDS).toContain("const [prefill, setPrefill] = useState<boolean | null>");
    expect(FIELDS).toContain("const [instruct, setInstruct] = useState<string | null>");
    expect(FIELDS).toContain("onClick={() => setPrefill(value)}");
    expect(FIELDS).toContain("onSelect={setInstruct}");
    // Carried by the update, not by a click.
    expect(FIELDS).toContain("supportsPrefill: prefill,");
    expect(FIELDS).toContain("instructTemplate: instruct,");
    expect(FIELDS).not.toMatch(/update\.mutate\(\s*\{ id: provider\.id, supportsPrefill: value \}/);
  });
});

describe("settings keeps its Models category", () => {
  test("because a phone has no rails to put this in", () => {
    expect(SETTINGS).toContain('show("models")');
    expect(SETTINGS).toContain("<ProviderFields");
    expect(SETTINGS).toContain("<ProfileFields");
  });
});
