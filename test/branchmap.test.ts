import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The branch map (§20 phase 172): a spatial view of a scene's real message
 * tree, every branch and checkpoint at once, reachable from the Tools sheet,
 * the palette, and the status bar.
 *
 * Structural, like the rest of this project's UI guards: no DOM rendering,
 * the source is read as text and the decisions are asserted where they are
 * written (`test/vanish.test.ts`, `test/overlay.test.ts` are the models).
 */

const ROOT = join(import.meta.dir, "..");
const SHARED_TYPES = readFileSync(join(ROOT, "shared", "types.ts"), "utf8");
const HISTORY = readFileSync(join(ROOT, "server", "db", "queries", "history.ts"), "utf8");
const SCENES_ROUTE = readFileSync(join(ROOT, "server", "routes", "scenes.ts"), "utf8");
const QUERIES = readFileSync(join(ROOT, "client", "lib", "queries.ts"), "utf8");
const BRANCH_MAP = readFileSync(join(ROOT, "client", "components", "BranchMap.tsx"), "utf8");
const COMMANDS = readFileSync(join(ROOT, "client", "lib", "commands.ts"), "utf8");
const CHAT_SCREEN = readFileSync(join(ROOT, "client", "screens", "ChatScreen.tsx"), "utf8");
const CHAT_SHEETS = readFileSync(join(ROOT, "client", "screens", "chat", "ChatSheets.tsx"), "utf8");
const STATUS_BAR = readFileSync(join(ROOT, "client", "components", "StatusBar.tsx"), "utf8");
const STRINGS = readFileSync(join(ROOT, "client", "strings.ts"), "utf8");

describe("the DTO", () => {
  test("a tree node is thin: no content, no segments, no media", () => {
    expect(SHARED_TYPES).toContain("export interface TreeNodeDto");
    expect(SHARED_TYPES).toContain("isCheckpoint: boolean");
    expect(SHARED_TYPES).toContain("isOnActivePath: boolean");
    expect(SHARED_TYPES).toContain("speakerColour: string | null");
    expect(SHARED_TYPES).not.toMatch(/TreeNodeDto[\s\S]{0,600}segments/);
  });

  test("the whole tree carries the active leaf, for marking where the reader is", () => {
    expect(SHARED_TYPES).toContain("export interface SceneTreeDto");
    expect(SHARED_TYPES).toMatch(/SceneTreeDto[\s\S]{0,120}activeLeafId: string \| null/);
  });
});

describe("the server", () => {
  test("sceneTree reads every message, not just the active path", () => {
    expect(HISTORY).toContain("export function sceneTree(db: Database, scene: SceneRow): SceneTreeDto");
    expect(HISTORY).toContain('"SELECT * FROM messages WHERE scene_id = $scene_id ORDER BY id"');
  });

  test("it reuses activePath and listCheckpoints rather than re-deriving them", () => {
    expect(HISTORY).toMatch(/sceneTree[\s\S]{0,900}activePath\(db, scene\.id\)/);
    expect(HISTORY).toMatch(/sceneTree[\s\S]{0,900}listCheckpoints\(db, scene\.id\)/);
  });

  test("the route is a plain GET, scoped under the scene", () => {
    expect(SCENES_ROUTE).toContain('app.get("/:sceneId/tree"');
    expect(SCENES_ROUTE).toMatch(/tree"[\s\S]{0,200}sceneTree\(ctx\.db, row\)/);
  });
});

describe("the client query", () => {
  test("is gated, so no chat screen fetches the whole tree just by opening", () => {
    expect(QUERIES).toContain("export function useSceneTree(sceneId: string, enabled: boolean)");
    expect(QUERIES).toMatch(/useSceneTree[\s\S]{0,200}enabled,/);
  });
});

describe("the collapsing graph layout", () => {
  test("a node is significant only for a real reason, never by depth alone", () => {
    expect(BRANCH_MAP).toContain("function isSignificant(node: TreeNodeDto): boolean");
    expect(BRANCH_MAP).toMatch(/isSignificant[\s\S]{0,400}node\.parentId === null/);
    expect(BRANCH_MAP).toMatch(/isSignificant[\s\S]{0,400}directChildren\(node\.id\)\.length !== 1/);
    expect(BRANCH_MAP).toMatch(/isSignificant[\s\S]{0,400}node\.isCheckpoint/);
    expect(BRANCH_MAP).toMatch(/isSignificant[\s\S]{0,400}node\.id === activeLeafId/);
  });

  test("an unbranched run collapses to one edge with a turn count, not one dot per message", () => {
    expect(BRANCH_MAP).toContain("function collapse(firstChildId: string)");
    expect(BRANCH_MAP).toMatch(/while \(!isSignificant\(current\)\)/);
    expect(BRANCH_MAP).toContain("turns += 1");
  });

  test("the turn count only renders past one, and never as a bare number with no explanation", () => {
    expect(BRANCH_MAP).toContain("edge.turns > 1 ?");
    expect(BRANCH_MAP).toContain("<title>{strings.chat.branchMapTurns(edge.turns)}</title>");
  });
});

describe("hand-rolled, not a library", () => {
  test("no graph or charting dependency was reached for", () => {
    expect(BRANCH_MAP).not.toMatch(/from ["'](d3|cytoscape|react-flow|dagre|vis-network)/);
  });

  test("the diagram is plain SVG lines and circles, with real buttons laid over it", () => {
    expect(BRANCH_MAP).toContain("<svg");
    expect(BRANCH_MAP).toContain("<circle");
    expect(BRANCH_MAP).not.toContain("<foreignObject");
  });
});

describe("clicking a node", () => {
  test("lands exactly there, the same as a checkpoint restore — never auto-descending", () => {
    expect(BRANCH_MAP).toMatch(
      /setLeaf\.mutate\(\{ messageId: node\.id, descend: false \}, \{ onSuccess: onClose \}\)/,
    );
  });

  test("the active leaf is named for a screen reader, not just ringed for the eye", () => {
    expect(BRANCH_MAP).toContain("strings.chat.branchMapHere");
    expect(BRANCH_MAP).toMatch(/node\.id === activeLeafId[\s\S]{0,120}branchMapHere/);
  });
});

describe("reachable three ways", () => {
  test("the palette carries it, scoped to an open scene", () => {
    expect(COMMANDS).toMatch(/id: "branch-map", title: c\.branchMap, scope: "scene"/);
  });

  test("the Tools sheet carries it, beside Checkpoints and Stats", () => {
    expect(CHAT_SHEETS).toContain(
      '<SheetAction label={strings.chat.opToolsBranchMap} onClick={onOpenBranchMap} />',
    );
  });

  test("the status bar carries a direct handle, not just the two menus", () => {
    expect(STATUS_BAR).toContain("onOpenBranchMap?: (() => void) | undefined;");
    expect(STATUS_BAR).toContain("{strings.chat.barBranchMap}");
  });

  test("the chat screen wires one piece of state to all three", () => {
    expect(CHAT_SCREEN).toContain("const [branchMapOpen, setBranchMapOpen] = useState(false);");
    expect(CHAT_SCREEN).toContain('"branch-map": () => setBranchMapOpen(true),');
  });
});

describe("strings", () => {
  test("every label the map needs exists, including the empty and loading states", () => {
    for (const key of [
      "branchMap:",
      "branchMapLoading:",
      "branchMapEmpty:",
      "branchMapCount:",
      "branchMapTurns:",
      "branchMapHere:",
      "barBranchMap:",
    ]) {
      expect(STRINGS).toContain(key);
    }
  });
});
