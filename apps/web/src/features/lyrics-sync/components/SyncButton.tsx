import { Button, Group, Tooltip } from "@mantine/core";
import { hasTimestamps } from "@musicbutler/lrc";
import { IconWand } from "@tabler/icons-react";
import type { FunctionComponent } from "react";

type Props = {
	editorText: string;
	songSelected: boolean;
	jobRunning: boolean;
	/** `needsConfirm` is true when the text already has timestamps (docs/PLAN.md §7.5). */
	onRequestSync: (needsConfirm: boolean) => void;
	onCancel: () => void;
	isCancelling: boolean;
};

/** The "Sync lyrics" button state machine (docs/PLAN.md §7.5, DECIDED). */
export const SyncButton: FunctionComponent<Props> = ({
	editorText,
	songSelected,
	jobRunning,
	onRequestSync,
	onCancel,
	isCancelling,
}) => {
	const empty = editorText.trim().length === 0;
	const reason = empty ? "Write the lyrics first" : !songSelected ? "Select a song" : null;

	if (jobRunning) {
		return (
			<Group gap="xs">
				<Button variant="default" loading disabled>
					Syncing…
				</Button>
				<Button variant="subtle" color="gray" onClick={onCancel} disabled={isCancelling}>
					Cancel
				</Button>
			</Group>
		);
	}

	const button = (
		<Button
			variant="default"
			leftSection={<IconWand size={18} />}
			disabled={reason !== null}
			onClick={() => onRequestSync(hasTimestamps(editorText))}
		>
			Sync lyrics
		</Button>
	);

	// A disabled button receives no pointer events, so Mantine's `events` option
	// lets the tooltip still open on hover and on keyboard focus.
	return reason === null ? (
		button
	) : (
		<Tooltip
			label={reason}
			position="top"
			withArrow
			events={{ hover: true, focus: true, touch: true }}
		>
			<span style={{ display: "inline-flex" }}>{button}</span>
		</Tooltip>
	);
};
