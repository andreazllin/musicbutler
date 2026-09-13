import { List, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconMusicSearch } from "@tabler/icons-react";
import type { FunctionComponent } from "react";

/**
 * What the editor column shows before a song is picked (docs/PLAN.md §7.3).
 * The screen has no other entry point, so this doubles as the instructions.
 */
export const NoSongSelected: FunctionComponent = () => (
	<Stack flex={1} mih={0} align="center" justify="center" gap="md" p="xl" ta="center">
		<ThemeIcon size={64} radius="xl" variant="light">
			<IconMusicSearch size={32} />
		</ThemeIcon>
		<Stack gap={4} align="center">
			<Title order={2} fz="lg" fw={600}>
				No song selected
			</Title>
			<Text fz="sm" c="dimmed" maw={420}>
				Select a song in the library on the left. The lyrics open here, next to the audio. You can
				write the lyrics and listen to check the timing.
			</Text>
		</Stack>
		<List fz="sm" c="dimmed" spacing={4} ta="left" maw={420} withPadding>
			<List.Item>Search finds a folder or a song at any depth.</List.Item>
			<List.Item>A green badge shows a song that has an .lrc file.</List.Item>
			<List.Item>Sync lyrics reads the audio and writes the timestamps.</List.Item>
		</List>
	</Stack>
);
