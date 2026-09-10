import { Group, Paper, Progress, Stack, Text } from "@mantine/core";
import type { FunctionComponent } from "react";
import { SYNC_STAGE_LABELS } from "../constants";
import type { SyncProgressState } from "../hooks/use-sync-job";

type Props = { progress: SyncProgressState };

/** Stage, message and percentage of the running job (docs/PLAN.md §8.2). */
export const SyncProgress: FunctionComponent<Props> = ({ progress }) => (
	<Paper withBorder px="sm" py="xs" bg="var(--mantine-color-default)">
		<Stack gap={6}>
			<Group justify="space-between" gap="sm" wrap="nowrap" fz="xs">
				<Text fz="xs" fw={500}>
					{SYNC_STAGE_LABELS[progress.stage]}
				</Text>
				<Group gap="xs" wrap="nowrap" miw={0}>
					{progress.message && (
						<Text fz="xs" c="dimmed" truncate>
							{progress.message}
						</Text>
					)}
					<Text fz="xs" c="dimmed" ff="monospace">
						{Math.round(progress.pct)}%
					</Text>
				</Group>
			</Group>
			<Progress value={Math.round(progress.pct)} size="sm" transitionDuration={200} />
		</Stack>
	</Paper>
);
