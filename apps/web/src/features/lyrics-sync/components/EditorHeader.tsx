import { ActionIcon, Badge, Box, CloseButton, Group, Text, Tooltip } from "@mantine/core";
import { lrcPathFor } from "@musicbutler/shared";
import { IconMenu2 } from "@tabler/icons-react";
import type { FunctionComponent } from "react";
import { baseNameOf } from "../helpers/paths";

type Props = {
	songPath: string | null;
	dirty: boolean;
	lrcExists: boolean | undefined;
	/** Clears the selection. The caller applies the unsaved-changes guard. */
	onClear: () => void;
	/** Opens the library. Set only when the library is a drawer, on a narrow screen. */
	onOpenLibrary?: (() => void) | undefined;
};

/** Song file name, the resolved `.lrc` path and the dirty indicator (docs/PLAN.md §7.3). */
export const EditorHeader: FunctionComponent<Props> = ({
	songPath,
	dirty,
	lrcExists,
	onClear,
	onOpenLibrary,
}) => (
	<Group
		component="header"
		mih={48}
		gap="md"
		wrap="nowrap"
		px="md"
		py="xs"
		style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
	>
		{onOpenLibrary !== undefined && (
			<Tooltip label="Open the library" withArrow>
				<ActionIcon
					variant="default"
					aria-label="Open the library"
					onClick={onOpenLibrary}
					style={{ flexShrink: 0 }}
				>
					<IconMenu2 size={18} />
				</ActionIcon>
			</Tooltip>
		)}
		{songPath === null ? (
			<Text fz="sm" c="dimmed">
				Select a song from the library to edit its lyrics.
			</Text>
		) : (
			<>
				<Box flex={1} miw={0}>
					<Text component="h1" m={0} fz="sm" fw={600} truncate title={songPath}>
						{baseNameOf(songPath)}
					</Text>
					<Text fz="xs" c="dimmed" ff="monospace" truncate title={lrcPathFor(songPath)}>
						{lrcPathFor(songPath)}
					</Text>
				</Box>
				{dirty ? (
					<Badge color="yellow" variant="light" size="sm" visibleFrom="xs">
						Unsaved changes
					</Badge>
				) : lrcExists ? (
					<Badge color="teal" variant="light" size="sm" visibleFrom="xs">
						Saved
					</Badge>
				) : (
					<Badge color="gray" variant="light" size="sm" visibleFrom="xs">
						No .lrc file
					</Badge>
				)}
				<Tooltip label="Close this song" position="left" withArrow>
					<CloseButton aria-label="Close this song" onClick={onClear} />
				</Tooltip>
			</>
		)}
	</Group>
);
