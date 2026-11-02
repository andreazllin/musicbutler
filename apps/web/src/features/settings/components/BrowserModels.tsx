import {
	Alert,
	Badge,
	Button,
	Group,
	Paper,
	Progress,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import type { BrowserModel } from "@musicbutler/shared";
import { IconAlertTriangle, IconDownload, IconTrash, IconX } from "@tabler/icons-react";
import { type FunctionComponent, useEffect, useState } from "react";
import { modelDescription, modelLabel } from "@/features/browser-sync/constants";
import type { LocalModelState } from "@/features/browser-sync/helpers/local-state";
import { useBrowserModels } from "@/features/browser-sync/hooks/use-browser-models";
import { formatBytes } from "@/lib/format";
import { notify } from "@/lib/notify";
import { useBrowserModelsStore } from "@/stores/browser-models-store";

const STATE_BADGE: Record<LocalModelState, { label: string; color: string }> = {
	ready: { label: "Downloaded", color: "teal" },
	outdated: { label: "Out of date", color: "yellow" },
	missing: { label: "Not downloaded", color: "gray" },
};

/** Space this site uses in the browser, and the most it may use. */
function useStorageEstimate(deps: unknown): { usage: number; quota: number } | null {
	const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
	useEffect(() => {
		void deps;
		if (!navigator.storage?.estimate) return;
		let live = true;
		void navigator.storage.estimate().then((e) => {
			if (live) setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 });
		});
		return () => {
			live = false;
		};
	}, [deps]);
	return estimate;
}

/**
 * The models a sync in this browser uses (the Settings screen). Each one can
 * be downloaded ahead of the first sync, or deleted to give the space back.
 */
export const BrowserModels: FunctionComponent = () => {
	const { models, isPending, isError, stateOf } = useBrowserModels();
	const local = useBrowserModelsStore((s) => s.local);
	const estimate = useStorageEstimate(local);

	return (
		<Paper withBorder p="md">
			<Stack gap="md">
				<Group justify="space-between" align="baseline" gap="sm">
					<Title order={2} fz="md" fw={600}>
						Models in this browser
					</Title>
					{estimate && estimate.quota > 0 && (
						<Text fz="xs" c="dimmed">
							This site uses {formatBytes(estimate.usage)} of {formatBytes(estimate.quota)}
						</Text>
					)}
				</Group>
				<Text fz="sm" c="dimmed">
					A sync in this browser needs the speech model for its language. It also needs vocal
					isolation when Isolate vocals first is on. The browser downloads each model from the
					server one time and keeps it.
				</Text>

				{isError ? (
					<Alert
						color="red"
						icon={<IconAlertTriangle size={18} />}
						title="The app cannot read the list of models"
					>
						Reload the page. If the problem stays, look at the server log.
					</Alert>
				) : isPending ? (
					<Text fz="sm" c="dimmed">
						Please wait.
					</Text>
				) : (
					<Stack gap={0}>
						{models.map((model, index) => (
							<ModelRow key={model.id} model={model} state={stateOf(model)} first={index === 0} />
						))}
					</Stack>
				)}
			</Stack>
		</Paper>
	);
};

type RowProps = { model: BrowserModel; state: LocalModelState; first: boolean };

const ModelRow: FunctionComponent<RowProps> = ({ model, state, first }) => {
	const download = useBrowserModelsStore((s) => s.downloads[model.id]);
	const startDownload = useBrowserModelsStore((s) => s.download);
	const cancelDownload = useBrowserModelsStore((s) => s.cancelDownload);
	const remove = useBrowserModelsStore((s) => s.remove);
	const [isRemoving, setIsRemoving] = useState(false);

	const isDownloading = download !== undefined && download.error === undefined;
	const badge = STATE_BADGE[state];
	const pct = isDownloading && download.total > 0 ? (download.received / download.total) * 100 : 0;

	const onDownload = () => {
		startDownload(model).then(
			() => notify.success(`The browser downloaded ${modelLabel(model.id)}.`),
			(err: unknown) => {
				if (err instanceof DOMException && err.name === "AbortError") return;
				notify.error(err instanceof Error ? err.message : "The download failed.");
			},
		);
	};

	const onRemove = () => {
		setIsRemoving(true);
		remove(model)
			.catch((err: unknown) =>
				notify.error(
					err instanceof Error ? err.message : "The browser could not delete the model.",
				),
			)
			.finally(() => setIsRemoving(false));
	};

	const downloadButton = (
		<Button
			size="compact-sm"
			variant={state === "outdated" ? "filled" : "default"}
			leftSection={<IconDownload size={16} />}
			disabled={!model.available}
			onClick={onDownload}
		>
			{state === "outdated" ? "Update" : "Download"}
		</Button>
	);

	return (
		<Stack
			gap={6}
			py="sm"
			style={first ? undefined : { borderTop: "1px solid var(--mantine-color-default-border)" }}
		>
			<Group justify="space-between" wrap="nowrap" gap="md" align="flex-start">
				<Stack gap={2} miw={0}>
					<Group gap="xs" wrap="nowrap">
						<Text fz="sm" fw={500} truncate>
							{modelLabel(model.id)}
						</Text>
						<Badge size="sm" variant="light" color={badge.color}>
							{badge.label}
						</Badge>
					</Group>
					<Text fz="xs" c="dimmed">
						{modelDescription(model.id)}{" "}
						{model.available ? formatBytes(model.bytes) : "The server does not have this model."}
					</Text>
				</Stack>
				<Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
					{isDownloading ? (
						<Button
							size="compact-sm"
							variant="subtle"
							color="gray"
							leftSection={<IconX size={16} />}
							onClick={() => cancelDownload(model.id)}
						>
							Cancel
						</Button>
					) : (
						<>
							{state !== "ready" &&
								(model.available ? (
									downloadButton
								) : (
									<Tooltip
										label="The server does not have this model"
										events={{ hover: true, focus: true, touch: true }}
									>
										<span style={{ display: "inline-flex" }}>{downloadButton}</span>
									</Tooltip>
								))}
							{state !== "missing" && (
								<Button
									size="compact-sm"
									variant="subtle"
									color="red"
									leftSection={<IconTrash size={16} />}
									loading={isRemoving}
									onClick={onRemove}
								>
									Delete
								</Button>
							)}
						</>
					)}
				</Group>
			</Group>
			{isDownloading && (
				<Stack gap={4}>
					<Progress
						value={pct}
						size="sm"
						transitionDuration={200}
						aria-label={`Download of ${modelLabel(model.id)}`}
					/>
					<Text fz="xs" c="dimmed" ff="monospace">
						{formatBytes(download.received)} of {formatBytes(download.total)}
					</Text>
				</Stack>
			)}
			{download?.error && (
				<Text fz="xs" c="red">
					{download.error}
				</Text>
			)}
		</Stack>
	);
};
