import { Button, Group, Tooltip } from "@mantine/core";
import { hasTimestamps } from "@musicbutler/lrc";
import { IconWand } from "@tabler/icons-react";
import type { FunctionComponent } from "react";

type Props = {
	editorText: string;
	jobRunning: boolean;
	/** `needsConfirm` is true when the text already has timestamps (docs/PLAN.md §7.5). */
	onRequestSync: (needsConfirm: boolean) => void;
	onCancel: () => void;
	isCancelling: boolean;
};

/** The "Sync lyrics" button state machine (docs/PLAN.md §7.5, DECIDED). */
export const SyncButton: FunctionComponent<Props> = ({
	editorText,
	jobRunning,
	onRequestSync,
	onCancel,
	isCancelling,
}) => {
	const reason = editorText.trim().length === 0 ? "Write the lyrics first" : null;

	if (jobRunning) {
		return (
			<Group gap="xs">
				<Button variant="default" loading disabled>
					Sync in progress
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
