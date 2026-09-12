import { useMemo } from "react";
import type { TreeNodeDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useSceneTree, useSetLeaf } from "../lib/queries.ts";

/**
 * A spatial view of a scene's real message tree (§20 phase 172).
 *
 * The tree has been real since the schema's first version — `parent_id`,
 * `scenes.active_leaf_id` — and nothing before this showed it as one. Paging
 * through a swipe carousel or a versions sheet answers "what else did this
 * turn say"; this answers "what does the whole thing look like."
 *
 * Hand-rolled, like every other primitive in this client: a graph library is
 * a dependency for something a plain SVG line and a button already do. Nodes
 * are drawn only at points that matter — a message with siblings (a branch),
 * a checkpoint, a leaf, a root, or wherever the reader is now — with every
 * unbranched run between two of those collapsed to one line and a turn count,
 * so a four-hundred-turn scene with one detour draws as a handful of points,
 * not four hundred dots in a column.
 */

const ROW_H = 34;
const COL_W = 26;
const NODE_R = 5;
const LABEL_GAP = 14;
const LABEL_W = 260;

interface Edge {
  from: string;
  to: string;
  /** Messages this edge collapses, this one included — the label's count. */
  turns: number;
}

interface Placed {
  node: TreeNodeDto;
  depth: number;
  order: number;
}

interface Graph {
  placed: Placed[];
  edges: Edge[];
}

/**
 * Which nodes are worth drawing, and the collapsed edges between them.
 *
 * A node earns a dot when it is a root (no parent), has a sibling count other
 * than exactly one child of its own parent (a fork or a dead end), is a named
 * checkpoint, or is the scene's current leaf. Everything else is mid-run: it
 * has exactly one parent, one child, and nothing marking it, so it folds into
 * whichever edge passes through it.
 */
function buildGraph(nodes: readonly TreeNodeDto[], activeLeafId: string | null): Graph {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Root messages share no real parent id, but they are siblings of one
  // another all the same (alternate greetings) — bucketed under one key so
  // that case is ordinary sibling detection, not a special case.
  const bucketKey = (parentId: string | null) => parentId ?? "\0root";
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    const key = bucketKey(node.parentId);
    const siblings = childrenOf.get(key) ?? [];
    siblings.push(node.id);
    childrenOf.set(key, siblings);
  }
  const directChildren = (id: string): string[] => childrenOf.get(id) ?? [];

  function isSignificant(node: TreeNodeDto): boolean {
    if (node.parentId === null) return true;
    if (directChildren(node.id).length !== 1) return true;
    if ((childrenOf.get(bucketKey(node.parentId)) ?? []).length > 1) return true;
    if (node.isCheckpoint) return true;
    if (node.id === activeLeafId) return true;
    return false;
  }

  const edges: Edge[] = [];
  /** Walk a single-child chain forward until the next node worth drawing. */
  function collapse(firstChildId: string): { to: string; turns: number } {
    let current = byId.get(firstChildId)!;
    let turns = 1;
    while (!isSignificant(current)) {
      const onlyChild = directChildren(current.id)[0]!;
      current = byId.get(onlyChild)!;
      turns += 1;
    }
    return { to: current.id, turns };
  }

  const placed: Placed[] = [];
  let order = 0;
  function visit(id: string, depth: number): void {
    placed.push({ node: byId.get(id)!, depth, order: order++ });
    for (const childId of directChildren(id)) {
      const { to, turns } = collapse(childId);
      edges.push({ from: id, to, turns });
      visit(to, depth + 1);
    }
  }
  for (const rootId of directChildren(bucketKey(null))) visit(rootId, 0);

  return { placed, edges };
}

/** What a node's row says: who spoke, or what kind of turn it was. */
function labelFor(node: TreeNodeDto, authorName: string | null): string {
  const who =
    node.authorType === "user"
      ? strings.chat.you
      : node.kind === "beat"
        ? (authorName ?? strings.chat.beatLabel)
        : (node.speakerName ?? authorName ?? strings.chat.narratorName);
  return node.preview === "" ? who : `${who} — ${node.preview}`;
}

export function BranchMapSheet({
  sceneId,
  authorName,
  onClose,
}: {
  sceneId: string;
  authorName: string | null;
  onClose(): void;
}) {
  const tree = useSceneTree(sceneId, true);
  const setLeaf = useSetLeaf(sceneId);

  const graph = useMemo(
    () => (tree.data === undefined ? null : buildGraph(tree.data.nodes, tree.data.activeLeafId)),
    [tree.data],
  );

  if (tree.isLoading || graph === null) {
    return (
      <Sheet title={strings.chat.branchMap} onClose={onClose}>
        <p className="explain py-[10px]">{strings.chat.branchMapLoading}</p>
      </Sheet>
    );
  }

  if (graph.placed.length === 0) {
    return (
      <Sheet title={strings.chat.branchMap} onClose={onClose}>
        <p className="explain py-[10px]">{strings.chat.branchMapEmpty}</p>
      </Sheet>
    );
  }

  const { placed, edges } = graph;
  const activeLeafId = tree.data!.activeLeafId;
  const byId = new Map(placed.map((entry) => [entry.node.id, entry]));
  const maxDepth = Math.max(...placed.map((entry) => entry.depth));
  const xOf = (depth: number) => depth * COL_W + NODE_R + 2;
  const yOf = (order: number) => order * ROW_H + ROW_H / 2;
  const width = xOf(maxDepth) + LABEL_GAP + LABEL_W;
  const height = placed.length * ROW_H;

  return (
    <Sheet title={strings.chat.branchMap} meta={strings.chat.branchMapCount(placed.length)} onClose={onClose}>
      {/* The diagram scrolls on its own axis inside the sheet's own vertical
          scroll — a deep branch on a narrow phone still reaches every node,
          it just costs a side-scroll instead of shrinking to illegibility. */}
      <div className="relative overflow-x-auto" style={{ width: "100%" }}>
        <div className="relative" style={{ width, height }}>
          <svg
            width={width}
            height={height}
            aria-hidden="true"
            className="absolute left-0 top-0"
            style={{ pointerEvents: "none" }}
          >
            {edges.map((edge) => {
              const from = byId.get(edge.from)!;
              const to = byId.get(edge.to)!;
              const x1 = xOf(from.depth);
              const y1 = yOf(from.order);
              const x2 = xOf(to.depth);
              const y2 = yOf(to.order);
              const onPath = from.node.isOnActivePath && to.node.isOnActivePath;
              return (
                <g key={`${edge.from}-${edge.to}`}>
                  <path
                    d={`M ${x1} ${y1} V ${y2} H ${x2}`}
                    fill="none"
                    stroke={onPath ? "var(--onsen-color-blue)" : "var(--onsen-color-rule)"}
                    strokeWidth={onPath ? 2 : 1.5}
                  />
                  {edge.turns > 1 ? (
                    // A compact badge, not the full sentence: the gutter
                    // between two columns is `COL_W` wide, a lot less than
                    // "12 turns" needs, and every row's own label already
                    // claims the space right after its node. Centred on the
                    // vertical run's midpoint — the one spot guaranteed clear
                    // of both rows' label bands — with the full count as a
                    // hover title for anyone who wants the sentence.
                    <g>
                      <title>{strings.chat.branchMapTurns(edge.turns)}</title>
                      <rect
                        x={x1 + 2}
                        y={(y1 + y2) / 2 - 6}
                        width={(String(edge.turns).length + 1) * 6 + 6}
                        height={12}
                        rx={2}
                        fill="var(--onsen-color-bg-sunken)"
                        stroke="var(--onsen-color-rule)"
                        strokeWidth={1}
                      />
                      <text
                        x={x1 + 5}
                        y={(y1 + y2) / 2 + 3}
                        style={{ font: "9px inherit", fill: "var(--onsen-color-text-dim)" }}
                      >
                        {"×"}
                        {edge.turns}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
            {placed.map(({ node, depth, order }) => (
              <circle
                key={node.id}
                cx={xOf(depth)}
                cy={yOf(order)}
                r={node.id === activeLeafId ? NODE_R + 2.5 : NODE_R}
                fill={
                  node.speakerColour ??
                  (node.isOnActivePath ? "var(--onsen-color-blue)" : "var(--onsen-color-bg-raised)")
                }
                stroke={
                  node.isCheckpoint ? "var(--onsen-color-amber)" : "var(--onsen-color-rule-strong)"
                }
                strokeWidth={node.isCheckpoint ? 2.5 : 1.5}
              />
            ))}
          </svg>
          {/* Real buttons laid over the decorative SVG, at the same
              coordinates — a `foreignObject` would do this inside the SVG
              itself, but a plain positioned button is what every other
              interactive row in this client already is. */}
          {placed.map(({ node, depth, order }) => (
            <button
              key={node.id}
              type="button"
              title={labelFor(node, authorName)}
              aria-label={
                node.id === activeLeafId
                  ? `${labelFor(node, authorName)} — ${strings.chat.branchMapHere}`
                  : labelFor(node, authorName)
              }
              onClick={() =>
                // Land exactly on the node clicked, the same as a checkpoint
                // restore does — a dot on this map is a specific point, not a
                // request to also inherit whatever a branch went on to say.
                setLeaf.mutate({ messageId: node.id, descend: false }, { onSuccess: onClose })
              }
              disabled={setLeaf.isPending}
              className="chrome absolute flex items-center truncate text-left text-[12.5px] disabled:opacity-40"
              style={{
                left: xOf(depth) + LABEL_GAP,
                top: yOf(order) - ROW_H / 2,
                width: LABEL_W,
                height: ROW_H,
                color:
                  node.id === activeLeafId
                    ? "var(--onsen-color-blue-text)"
                    : "var(--onsen-color-text-label)",
              }}
            >
              {labelFor(node, authorName)}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
