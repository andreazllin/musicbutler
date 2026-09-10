import { Badge, Box, Group, Text } from "@mantine/core";
import { lrcPathFor } from "@musicbutler/shared";
import type { FunctionComponent } from "react";
import { baseNameOf } from "../helpers/paths";

type Props = {
	songPath: string | null;
	dirty: boolean;
	lrcExists: boolean | undefined;
};

/** Song file name, the resolved `.lrc` path and the dirty indicator (docs/PLAN.md §7.3). */
export const EditorHeader: FunctionComponent<Props> = ({ songPath, dirty, lrcExists }) => (
	<Group
		component="header"
		mih={48}
		gap="md"
		wrap="nowrap"
		px="md"
		py="xs"
		style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
	>
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
					<Badge color="yellow" variant="light" size="sm">
						Unsaved changes
					</Badge>
				) : lrcExists ? (
					<Badge color="teal" variant="light" size="sm">
						Saved
					</Badge>
				) : (
					<Badge color="gray" variant="light" size="sm">
						No .lrc file
					</Badge>
				)}
			</>
		)}
	</Group>
);
