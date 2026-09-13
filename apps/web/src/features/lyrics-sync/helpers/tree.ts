import type { TreeNodeData } from "@mantine/core";
import type { LibraryTree, TreeEntry } from "@musicbutler/shared";
import { fuzzyMatches } from "../../../lib/fuzzy";

/** What `renderNode` reads back off a node. */
export type NodeProps = { kind: TreeEntry["kind"]; hasLrc: boolean; childCount: number };

export const nodePropsOf = (node: TreeNodeData): NodeProps | undefined =>
	node.nodeProps as NodeProps | undefined;

/** Turns the server's tree into the shape Mantine's `Tree` draws. */
export function toNodes(entries: TreeEntry[]): TreeNodeData[] {
	return entries.map((entry) =>
		entry.kind === "dir"
			? {
					value: entry.path,
					label: entry.name,
					children: toNodes(entry.children),
					nodeProps: {
						kind: "dir",
						hasLrc: false,
						childCount: entry.children.length,
					} satisfies NodeProps,
				}
			: {
					value: entry.path,
					label: entry.name,
					nodeProps: {
						kind: "audio",
						hasLrc: entry.hasLrc,
						childCount: 0,
					} satisfies NodeProps,
				},
	);
}

/** Every library path in the tree that is a directory. */
export function directoryPaths(entries: TreeEntry[], into = new Set<string>()): Set<string> {
	for (const entry of entries) {
		if (entry.kind === "dir") {
			into.add(entry.path);
			directoryPaths(entry.children, into);
		}
	}
	return into;
}

export type FilterResult = {
	nodes: TreeNodeData[];
	/** Folders that have to be open for the matches to be on screen. */
	expand: string[];
	/** Set when the cap stopped the result short. */
	truncated: boolean;
};

/**
 * Ceiling on the rows a filter draws. Matching the whole library is cheap, a few
 * tens of milliseconds over ten thousand nodes; drawing the result is not, and a
 * broad query can match thousands. Nobody reads the four thousandth hit, so the
 * list stops and says so, and the answer is to type more.
 *
 * The count can pass the cap by the depth of the branch it stopped in, because
 * the folders above a match are kept with it. The point is to bound what is
 * drawn, and a handful of extra rows does not change that.
 */
export const MAX_FILTER_RESULTS = 300;

/**
 * Narrows the tree to what matches, fuzzily, on either the name or the whole
 * path. A folder that matches keeps its subtree, so searching for a folder
 * shows the songs inside it; a song that matches keeps the folders above it, so
 * a result is never shown without saying where it lives.
 */
export function filterNodes(
	nodes: TreeNodeData[],
	query: string,
	limit = MAX_FILTER_RESULTS,
): FilterResult {
	if (query.trim() === "") return { nodes, expand: [], truncated: false };
	const expand: string[] = [];
	let kept = 0;
	let truncated = false;

	const walk = (current: TreeNodeData[], ancestorMatched: boolean): TreeNodeData[] =>
		current.flatMap((node) => {
			if (kept >= limit) {
				truncated = true;
				return [];
			}
			const self = ancestorMatched || fuzzyMatches(query, String(node.label), node.value);
			const children = node.children ? walk(node.children, self) : undefined;
			const keep = self || (children !== undefined && children.length > 0);
			if (!keep) return [];
			kept += 1;
			// A folder is only worth opening when something under it survived.
			if (children !== undefined && children.length > 0) expand.push(node.value);
			return [{ ...node, children }];
		});

	return { nodes: walk(nodes, false), expand, truncated };
}

/**
 * The tree with one song's "has lyrics" flag changed, sharing every untouched
 * node. Saving patches the cached tree this way instead of invalidating it,
 * because invalidating means walking the whole library again for a flag that
 * one write already settled.
 */
export function withHasLrc(tree: LibraryTree, path: string, hasLrc: boolean): LibraryTree {
	let changed = false;

	const walk = (entries: TreeEntry[]): TreeEntry[] => {
		const next = entries.map((entry) => {
			if (entry.kind === "audio") {
				if (entry.path !== path || entry.hasLrc === hasLrc) return entry;
				changed = true;
				return { ...entry, hasLrc };
			}
			// Only the branch that can hold the path is walked, so a save stays
			// cheap however large the library is.
			if (!path.startsWith(`${entry.path}/`)) return entry;
			const children = walk(entry.children);
			return children === entry.children ? entry : { ...entry, children };
		});
		return changed ? next : entries;
	};

	const children = walk(tree.children);
	return changed ? { ...tree, children } : tree;
}
