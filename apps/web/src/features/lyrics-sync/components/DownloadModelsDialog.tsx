import { List, Text } from "@mantine/core";
import type { BrowserModel } from "@musicbutler/shared";
import type { FunctionComponent } from "react";
import { modelLabel } from "@/features/browser-sync/constants";
import { formatBytes } from "@/lib/format";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
	/** The models to download. The dialog is open while this is not null. */
	models: BrowserModel[] | null;
	onClose: () => void;
	onConfirm: () => void;
};

/**
 * Asked before the first sync in this browser. The models are hundreds of
 * megabytes, so the app never downloads them without a yes.
 */
export const DownloadModelsDialog: FunctionComponent<Props> = ({ models, onClose, onConfirm }) => {
	const total = (models ?? []).reduce((sum, m) => sum + m.bytes, 0);
	return (
		<ConfirmDialog
			isOpen={models !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title="Download the models?"
			confirmLabel={`Download ${formatBytes(total)} and sync`}
			onConfirm={onConfirm}
		>
			<Text fz="sm">
				This browser runs the sync. It must first download these models from the server:
			</Text>
			<List fz="sm" spacing={4}>
				{(models ?? []).map((m) => (
					<List.Item key={m.id}>
						{modelLabel(m.id)}, {formatBytes(m.bytes)}
					</List.Item>
				))}
			</List>
			<Text fz="sm">
				The browser keeps the models, so the next sync starts immediately. To run the sync on the
				server, change the setting in Settings.
			</Text>
		</ConfirmDialog>
	);
};
