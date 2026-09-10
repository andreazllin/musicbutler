import { IconMusic } from "@tabler/icons-react";
import { type ComponentType, createElement, lazy, type ReactNode } from "react";

/**
 * The tool registry (docs/PLAN.md §7.1). The sidebar and the route table both
 * read from this list, so a second tool adds one entry here and nothing else.
 */
export type ToolDefinition = {
	id: string;
	label: string;
	icon: ComponentType<{ size?: number | string }>;
	/** Route path, for example "/tools/lyrics-sync". */
	path: string;
	/** Lazy page component. */
	element: () => ReactNode;
};

const LyricsSyncPage = lazy(() =>
	import("@/pages/lyrics-sync-page").then((m) => ({ default: m.LyricsSyncPage })),
);

export const TOOLS = [
	{
		id: "lyrics-sync",
		label: "Lyrics Sync",
		icon: IconMusic,
		path: "/tools/lyrics-sync",
		element: () => createElement(LyricsSyncPage),
	},
] as const satisfies readonly ToolDefinition[];

export type ToolPath = (typeof TOOLS)[number]["path"];

export const DEFAULT_TOOL_PATH: ToolPath = TOOLS[0].path;
