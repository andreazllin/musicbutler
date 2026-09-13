import { Paper, Stack, Switch, Text } from "@mantine/core";
import type { FunctionComponent } from "react";
import { useLyricsSyncStore } from "@/stores/lyrics-sync-store";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
};

/**
 * Shown when the editor already holds timestamps (docs/PLAN.md §7.5). It states
 * plainly that the sync discards them and overwrites the file, and that the
 * result is written on the server so no Save follows.
 */
export const SyncConfirmDialog: FunctionComponent<Props> = ({
	isOpen,
	onOpenChange,
	onConfirm,
}) => {
	const isolateVocals = useLyricsSyncStore((s) => s.isolateVocals);
	const setIsolateVocals = useLyricsSyncStore((s) => s.setIsolateVocals);
	const wordTimestamps = useLyricsSyncStore((s) => s.wordTimestamps);
	const setWordTimestamps = useLyricsSyncStore((s) => s.setWordTimestamps);
	return (
		<ConfirmDialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			title="Replace the existing timestamps?"
			confirmLabel="Sync and overwrite"
			confirmColor="red"
			onConfirm={onConfirm}
		>
			<Text fz="sm">
				The sync{" "}
				<Text span fw={600} c="var(--mantine-color-text)">
					removes every timestamp
				</Text>{" "}
				in the editor. It makes new timestamps from the audio.
			</Text>
			<Text fz="sm">
				The sync also{" "}
				<Text span fw={600} c="var(--mantine-color-text)">
					writes the .lrc file
				</Text>{" "}
				on disk when it completes. You do not have to select Save.
			</Text>
			<Paper withBorder p="md" bg="var(--mantine-color-default)" mt="xs">
				<Stack gap="md">
					<Switch
						size="sm"
						label="Isolate vocals first"
						description="This is more accurate on a dense mix. It is about three times slower."
						checked={isolateVocals}
						onChange={(event) => setIsolateVocals(event.currentTarget.checked)}
					/>
					<Switch
						size="sm"
						label="Word timestamps"
						description="This writes a <mm:ss.xx> tag for each word (enhanced LRC), and keeps the line tags."
						checked={wordTimestamps}
						onChange={(event) => setWordTimestamps(event.currentTarget.checked)}
					/>
				</Stack>
			</Paper>
		</ConfirmDialog>
	);
};
