import {
	Alert,
	Badge,
	Box,
	Button,
	Group,
	mergeAsyncChildren,
	type RenderTreeNodePayload,
	Skeleton,
	Stack,
	Text,
	TextInput,
	Tree,
	type TreeNodeData,
	useTree,
} from "@mantine/core";
import { type Entry, isAudioFile } from "@musicbutler/shared";
import {
	IconAlertTriangle,
	IconChevronRight,
	IconFileText,
	IconFolder,
	IconFolderSearch,
	IconMusic,
	IconSearch,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
	type FunctionComponent,
	type ReactNode,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTRPC } from "@/lib/trpc";
import { useLyricsSyncStore } from "@/stores/lyrics-sync-store";
import { useLibraryDir } from "../hooks/use-library-dir";
import classes from "./FileTree.module.css";

type Props = {
	selectedPath: string | null;
	/** Called when the user picks an audio row. The caller applies the dirty guard. */
	onSelectAudio: (path: string) => void;
};

/** A library entry, carried on the node so `renderNode` can read kind and badges. */
type NodeProps = { entry: Entry };

function toNode(entry: Entry): TreeNodeData {
	return {
		value: entry.path,
		label: entry.name,
		// A directory with children loads them the first time it is expanded.
		hasChildren: entry.kind === "dir" && entry.childCount > 0,
		nodeProps: { entry } satisfies NodeProps,
	};
}

const entryOf = (node: TreeNodeData): Entry | undefined =>
	(node.nodeProps as NodeProps | undefined)?.entry;

/**
 * The library tree (docs/PLAN.md §7.3). Directories load one level at a time
 * over `library.list`; nothing walks the whole library. The filter box narrows
 * the loaded nodes only. Every data surface handles pending, error and empty.
 */
export const FileTree: FunctionComponent<Props> = ({ selectedPath, onSelectAudio }) => {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const expanded = useLyricsSyncStore((s) => s.expanded);
	const setExpandedState = useLyricsSyncStore((s) => s.setExpandedState);
	const treeFilter = useLyricsSyncStore((s) => s.treeFilter);
	const setTreeFilter = useLyricsSyncStore((s) => s.setTreeFilter);
	const root = useLibraryDir("");

	// Every library path seen so far that is a directory. `useTree` keeps the
	// callbacks it was given on the first render, so the selection handler reads
	// this ref instead of closing over the node data, which would be stale.
	const dirPaths = useRef(new Set<string>());
	const remember = useCallback((entries: Entry[]) => {
		for (const entry of entries) if (entry.kind === "dir") dirPaths.current.add(entry.path);
		return entries.map(toNode);
	}, []);

	// The loaded shape of the tree. The root listing seeds it; every expanded
	// directory grafts its own listing on through `mergeAsyncChildren`.
	const [loaded, setLoaded] = useState<TreeNodeData[]>([]);
	const rootNodes = useMemo(() => remember(root.data?.entries ?? []), [root.data, remember]);
	const data = loaded.length > 0 ? loaded : rootNodes;

	const loadChildren = useCallback(
		async (path: string) => {
			const listing = await queryClient.fetchQuery(trpc.library.list.queryOptions({ path }));
			const children = remember(listing.entries);
			setLoaded((current) =>
				mergeAsyncChildren(current.length > 0 ? current : rootNodes, path, children),
			);
		},
		[queryClient, trpc, rootNodes, remember],
	);

	const selectedState = useMemo(
		() => (selectedPath === null ? [] : [selectedPath]),
		[selectedPath],
	);

	const onSelect = useCallback(
		(values: string[]) => {
			const value = values.at(-1);
			// Directories expand on click; only audio rows change the selection. The
			// extension is checked too, so a directory the ref has not seen yet can
			// never reach `lrc.get`, which rejects anything that is not an audio file.
			if (value !== undefined && !dirPaths.current.has(value) && isAudioFile(value)) {
				onSelectAudio(value);
			}
		},
		[onSelectAudio],
	);

	const tree = useTree({
		expandedState: expanded,
		onExpandedStateChange: setExpandedState,
		selectedState,
		onSelectedStateChange: onSelect,
		onLoadChildren: loadChildren,
	});

	return (
		<Stack gap={0} h="100%" mih={0}>
			<Box p="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
				<TextInput
					aria-label="Filter loaded songs and folders"
					placeholder="Filter loaded items"
					size="sm"
					leftSection={<IconSearch size={16} />}
					value={treeFilter}
					onChange={(event) => setTreeFilter(event.currentTarget.value)}
				/>
			</Box>
			<Box flex={1} mih={0} p="xs" style={{ overflow: "auto" }}>
				{root.isPending ? (
					<TreeSkeleton />
				) : root.isError ? (
					<SurfaceError
						title="The library could not be listed"
						detail={root.error.message}
						onRetry={() => void root.refetch()}
					/>
				) : root.data.entries.length === 0 ? (
					<EmptySurface
						title="Nothing here yet"
						description="Point MUSIC_DIR at a library that holds audio files. Supported formats include mp3, flac, m4a, ogg and opus."
					/>
				) : (
					<FilteredTree tree={tree} data={data} filter={treeFilter} />
				)}
			</Box>
		</Stack>
	);
};

type FilteredProps = {
	tree: ReturnType<typeof useTree>;
	data: TreeNodeData[];
	filter: string;
};

/**
 * The tree itself. The filter narrows the loaded nodes only: a directory stays
 * visible while it is expanded, so filtering never collapses the path the user
 * is looking at.
 */
const FilteredTree: FunctionComponent<FilteredProps> = ({ tree, data, filter }) => {
	const needle = filter.trim().toLowerCase();
	const visible = useMemo(() => {
		if (!needle) return data;
		const keep = (nodes: TreeNodeData[]): TreeNodeData[] =>
			nodes.flatMap((node) => {
				const children = node.children ? keep(node.children) : undefined;
				const matches = String(node.label).toLowerCase().includes(needle);
				if (!matches && (children === undefined || children.length === 0)) return [];
				return [{ ...node, children }];
			});
		return keep(data);
	}, [data, needle]);

	if (visible.length === 0) {
		return (
			<EmptySurface
				title="No matches"
				description={`Nothing loaded matches “${filter}”. Clear the filter or expand more folders.`}
			/>
		);
	}
	return (
		<Tree
			tree={tree}
			data={visible}
			aria-label="Music library"
			levelOffset={16}
			selectOnClick
			expandOnClick
			renderNode={renderNode}
		/>
	);
};

/** One row: chevron, icon, name, and the "has lyrics" badge on audio rows. */
function renderNode({
	node,
	expanded,
	hasChildren,
	elementProps,
	tree,
	isLoading,
	loadError,
}: RenderTreeNodePayload): ReactNode {
	const entry = entryOf(node);
	const dir = entry?.kind === "dir" ? entry : null;
	const isDir = dir !== null;
	return (
		<div {...elementProps} className={`${elementProps.className} ${classes.node}`}>
			{isDir ? (
				<span
					className={`${classes.chevron} ${expanded ? classes.chevronExpanded : ""}`}
					aria-hidden="true"
					style={{ visibility: hasChildren ? undefined : "hidden" }}
				>
					<IconChevronRight size={16} />
				</span>
			) : (
				<span className={classes.chevronSpacer} aria-hidden="true" />
			)}
			{isDir ? (
				<IconFolder size={16} style={{ flexShrink: 0 }} aria-hidden="true" />
			) : (
				<IconMusic
					size={16}
					style={{ flexShrink: 0, color: "var(--mantine-primary-color-filled)" }}
					aria-hidden="true"
				/>
			)}
			<Text component="span" flex={1} miw={0} truncate fz="sm" inherit>
				{node.label}
			</Text>
			{isLoading && (
				<Text component="span" fz="xs" c="dimmed" fs="italic">
					Loading…
				</Text>
			)}
			{loadError && (
				<Text
					component="span"
					fz="xs"
					c="red"
					title={loadError.message}
					onClick={(event) => {
						event.stopPropagation();
						tree.invalidateNode(node.value);
						void tree.loadNode(node.value);
					}}
				>
					Failed — retry
				</Text>
			)}
			{dir !== null && dir.childCount === 0 && (
				<Text component="span" fz="xs" c="dimmed">
					empty
				</Text>
			)}
			{entry?.kind === "audio" && entry.hasLrc && (
				<Badge
					color="teal"
					variant="light"
					size="sm"
					style={{ flexShrink: 0 }}
					leftSection={<IconFileText size={11} />}
				>
					lyrics
				</Badge>
			)}
		</div>
	);
}

const TreeSkeleton: FunctionComponent = () => (
	<Stack gap="xs" p={4} aria-busy="true" aria-label="Loading library">
		{Array.from({ length: 8 }, (_, i) => (
			// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
			<Group key={i} gap="xs" h={32} px="xs" wrap="nowrap">
				<Skeleton height={16} width={16} radius="sm" />
				<Skeleton height={12} width={`${45 + ((i * 17) % 40)}%`} radius="sm" />
			</Group>
		))}
	</Stack>
);

type ErrorProps = { title: string; detail: string; onRetry: () => void };
export const SurfaceError: FunctionComponent<ErrorProps> = ({ title, detail, onRetry }) => (
	<Alert color="red" variant="light" title={title} icon={<IconAlertTriangle size={18} />} my="md">
		<Stack gap="sm" align="flex-start">
			<Text fz="sm">{detail}</Text>
			<Button size="xs" variant="default" onClick={onRetry}>
				Try again
			</Button>
		</Stack>
	</Alert>
);

type EmptyProps = { title: string; description: ReactNode };
export const EmptySurface: FunctionComponent<EmptyProps> = ({ title, description }) => (
	<Stack align="center" gap="xs" py="xl" px="md" ta="center">
		<IconFolderSearch size={28} color="var(--mantine-color-dimmed)" aria-hidden="true" />
		<Text fw={600} fz="sm">
			{title}
		</Text>
		<Text fz="sm" c="dimmed">
			{description}
		</Text>
	</Stack>
);
