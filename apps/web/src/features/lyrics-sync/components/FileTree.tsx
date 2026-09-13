import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Button,
	Group,
	type RenderTreeNodePayload,
	Skeleton,
	Stack,
	Text,
	TextInput,
	Tooltip,
	Tree,
	useTree,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { isAudioFile } from "@musicbutler/shared";
import {
	IconAlertTriangle,
	IconChevronRight,
	IconFileText,
	IconFolder,
	IconFolderSearch,
	IconFoldUp,
	IconMusic,
	IconSearch,
} from "@tabler/icons-react";
import {
	type FunctionComponent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { useLyricsSyncStore } from "@/stores/lyrics-sync-store";
import { ancestorsOf } from "../helpers/paths";
import {
	directoryPaths,
	filterNodes,
	MAX_FILTER_RESULTS,
	nodePropsOf,
	toNodes,
} from "../helpers/tree";
import { useLibraryTree } from "../hooks/use-library-tree";
import classes from "./FileTree.module.css";

type Props = {
	selectedPath: string | null;
	/** Called when the user picks an audio row. The caller applies the dirty guard. */
	onSelectAudio: (path: string) => void;
};

/**
 * The library tree (docs/PLAN.md §7.3). The whole library arrives in one
 * `library.tree` query, so the filter reaches every folder and song at any
 * depth without the user opening anything first. Every data surface handles
 * pending, error and empty.
 */
export const FileTree: FunctionComponent<Props> = ({ selectedPath, onSelectAudio }) => {
	const expanded = useLyricsSyncStore((s) => s.expanded);
	const setExpandedState = useLyricsSyncStore((s) => s.setExpandedState);
	const collapseAllFolders = useLyricsSyncStore((s) => s.collapseAllFolders);
	const treeFilter = useLyricsSyncStore((s) => s.treeFilter);
	const setTreeFilter = useLyricsSyncStore((s) => s.setTreeFilter);
	const library = useLibraryTree();

	const all = useMemo(() => toNodes(library.data?.children ?? []), [library.data]);
	// Matching is cheap; drawing the result is not. Debouncing keeps a keystroke
	// from redrawing hundreds of rows before the next one lands.
	const [query] = useDebouncedValue(treeFilter, 150);
	const {
		nodes,
		expand,
		truncated: tooManyMatches,
	} = useMemo(() => filterNodes(all, query), [all, query]);

	// `useTree` keeps the callbacks it was given on the first render, so anything
	// they read comes from a ref. Passing the handler directly froze the caller's
	// unsaved-changes check at its first value, and passing the node data froze it
	// empty, which made every folder click select the folder as a song.
	const onSelectAudioRef = useRef(onSelectAudio);
	onSelectAudioRef.current = onSelectAudio;
	const dirPaths = useMemo(() => directoryPaths(library.data?.children ?? []), [library.data]);
	const dirPathsRef = useRef(dirPaths);
	dirPathsRef.current = dirPaths;

	const onSelect = useCallback((values: string[]) => {
		const value = values.at(-1);
		// Directories expand on click; only audio rows change the selection. The
		// extension is checked too, so a directory that happens to be named like a
		// song can never reach `lrc.get`, which rejects anything but an audio file.
		if (value !== undefined && !dirPathsRef.current.has(value) && isAudioFile(value)) {
			onSelectAudioRef.current(value);
		}
	}, []);

	/** The root listing ("") is open from the start, so it does not count. */
	const anyFolderOpen = useMemo(
		() => Object.entries(expanded).some(([path, open]) => open && path !== ""),
		[expanded],
	);

	const selectedState = useMemo(
		() => (selectedPath === null ? [] : [selectedPath]),
		[selectedPath],
	);

	// While the filter is on, the folders holding the matches are forced open so
	// the results are on screen. Mantine writes that back through
	// `onExpandedStateChange`, so the path stays open after the filter is
	// cleared: you search, you find it, and it is still where you can see it.
	const expandedState = useMemo(() => {
		if (expand.length === 0) return expanded;
		return { ...expanded, ...Object.fromEntries(expand.map((path) => [path, true])) };
	}, [expanded, expand]);

	const tree = useTree({
		expandedState,
		onExpandedStateChange: setExpandedState,
		selectedState,
		onSelectedStateChange: onSelect,
	});

	/**
	 * Opens the path down to the selected song. A link or a reload otherwise
	 * lands on a song with the tree collapsed, and in a library whose shape is
	 * unknown there is nothing to say which folders to open to reach it.
	 */
	const expandedRef = useRef(expanded);
	expandedRef.current = expanded;
	const revealed = useRef<string | null>(null);
	useEffect(() => {
		if (selectedPath === null || !library.isSuccess) return;
		if (revealed.current === selectedPath) return;
		revealed.current = selectedPath;
		const chain = ancestorsOf(selectedPath).filter((dir) => dir !== "");
		if (chain.every((dir) => expandedRef.current[dir])) return;
		setExpandedState({
			...expandedRef.current,
			...Object.fromEntries(chain.map((dir) => [dir, true])),
		});
	}, [selectedPath, library.isSuccess, setExpandedState]);

	return (
		<Stack gap={0} h="100%" mih={0}>
			<Box p="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
				<Group gap="xs" wrap="nowrap">
					<TextInput
						flex={1}
						aria-label="Search the library"
						placeholder="Search folders and songs"
						size="sm"
						leftSection={<IconSearch size={16} />}
						value={treeFilter}
						onChange={(event) => setTreeFilter(event.currentTarget.value)}
					/>
					{/* A deep library opens many folders on the way to one song. This
					    puts the tree back to the top in one action. */}
					<Tooltip label="Close all folders" withArrow>
						<ActionIcon
							variant="default"
							size="input-sm"
							aria-label="Close all folders"
							disabled={!anyFolderOpen}
							onClick={collapseAllFolders}
						>
							<IconFoldUp size={16} />
						</ActionIcon>
					</Tooltip>
				</Group>
			</Box>
			<Box flex={1} mih={0} p="xs" style={{ overflow: "auto" }}>
				{library.isPending ? (
					<TreeSkeleton />
				) : library.isError ? (
					<SurfaceError
						title="The app could not read the library"
						detail={library.error.message}
						onRetry={() => void library.refetch()}
					/>
				) : all.length === 0 ? (
					<EmptySurface
						title="The library is empty"
						description="Set MUSIC_DIR to a folder that holds audio files. The app reads mp3, flac, m4a, ogg and opus files."
					/>
				) : nodes.length === 0 ? (
					<EmptySurface
						title="No matches"
						description={`Nothing in the library matches “${query}”.`}
					/>
				) : (
					<>
						{tooManyMatches && (
							<Alert color="blue" variant="light" icon={<IconSearch size={16} />} mb="xs" p="xs">
								<Text fz="xs">
									This list shows the first {MAX_FILTER_RESULTS} matches. Type more characters to
									narrow the list.
								</Text>
							</Alert>
						)}
						{library.data.truncated && (
							<Alert
								color="yellow"
								variant="light"
								icon={<IconAlertTriangle size={16} />}
								mb="xs"
								p="xs"
							>
								<Text fz="xs">
									The library is larger than this list. The list shows the first{" "}
									{library.data.count.toLocaleString()} folders and songs.
								</Text>
							</Alert>
						)}
						<Tree
							tree={tree}
							data={nodes}
							aria-label="Music library"
							levelOffset={16}
							selectOnClick
							expandOnClick
							renderNode={renderNode}
						/>
					</>
				)}
			</Box>
		</Stack>
	);
};

/** One row: chevron, icon, name, and the "has lyrics" badge on audio rows. */
function renderNode({
	node,
	expanded,
	hasChildren,
	elementProps,
}: RenderTreeNodePayload): ReactNode {
	const props = nodePropsOf(node);
	const isDir = props?.kind === "dir";
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
			{isDir && props.childCount === 0 && (
				<Text component="span" fz="xs" c="dimmed">
					empty
				</Text>
			)}
			{props?.kind === "audio" && props.hasLrc && (
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
	<Stack gap="xs" p={4} aria-busy="true" aria-label="The app reads the library">
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
