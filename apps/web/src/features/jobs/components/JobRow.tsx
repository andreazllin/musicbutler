import { Badge, Button, Group, Paper, Progress, Stack, Text, Tooltip } from "@mantine/core";
import { isActiveJob, type JobStatus, type JobSummary, LANG_LABELS } from "@musicbutler/shared";
import { IconX } from "@tabler/icons-react";
import type { FunctionComponent } from "react";
import { SYNC_STAGE_LABELS } from "@/features/lyrics-sync/constants";
import { baseNameOf, parentDirOf } from "@/features/lyrics-sync/helpers/paths";
import { elapsedLabel } from "../helpers/queue";

const STATUS_COLORS: Record<JobStatus, string> = {
	queued: "gray",
	running: "blue",
	done: "teal",
	error: "red",
	cancelled: "gray",
};

const STATUS_LABELS: Record<JobStatus, string> = {
	queued: "In the queue",
	running: "Runs now",
	done: "Done",
	error: "Failed",
	cancelled: "Cancelled",
};

type Props = {
	job: JobSummary;
	/** Place in the queue, 1 for the next job to start. Null for the other states. */
	queuePosition: number | null;
	now: number;
	onCancel: (jobId: string) => void;
	isCancelling: boolean;
	onOpen: (audioPath: string) => void;
};

/** One job in the queue: what it works on, how far it got, and how to stop it. */
export const JobRow: FunctionComponent<Props> = ({
	job,
	queuePosition,
	now,
	onCancel,
	isCancelling,
	onOpen,
}) => {
	const folder = parentDirOf(job.audioPath);
	const elapsed = elapsedLabel(job, now);
	const active = isActiveJob(job.status);

	return (
		<Paper withBorder p="sm">
			<Stack gap="xs">
				<Group justify="space-between" wrap="nowrap" gap="sm">
					<Stack gap={2} miw={0} flex={1}>
						<Text fw={500} truncate="end" title={job.audioPath}>
							{baseNameOf(job.audioPath)}
						</Text>
						{folder !== "" && (
							<Text fz="xs" c="dimmed" truncate="end" title={folder}>
								{folder}
							</Text>
						)}
					</Stack>

					<Group gap="xs" wrap="nowrap">
						<Badge variant="light" color="gray">
							{LANG_LABELS[job.lang]}
						</Badge>
						<Badge variant="light" color={STATUS_COLORS[job.status]}>
							{job.status === "queued" && queuePosition !== null
								? `No. ${queuePosition} in the queue`
								: STATUS_LABELS[job.status]}
						</Badge>
						{elapsed !== null && (
							<Text fz="xs" c="dimmed" w={56} ta="right">
								{elapsed}
							</Text>
						)}
						{active ? (
							<Tooltip label="Cancel this job" withArrow>
								<Button
									size="compact-sm"
									variant="outline"
									color="red"
									leftSection={<IconX size={14} />}
									loading={isCancelling}
									onClick={() => onCancel(job.id)}
								>
									Cancel
								</Button>
							</Tooltip>
						) : (
							<Button size="compact-sm" variant="default" onClick={() => onOpen(job.audioPath)}>
								Open
							</Button>
						)}
					</Group>
				</Group>

				{job.status === "running" && (
					<Stack gap={4}>
						<Group justify="space-between" gap="sm">
							<Text fz="xs" c="dimmed">
								{SYNC_STAGE_LABELS[job.stage]}
								{job.message ? ` (${job.message})` : ""}
							</Text>
							<Text fz="xs" c="dimmed">
								{Math.round(job.pct)}%
							</Text>
						</Group>
						<Progress value={job.pct} size="sm" radius="xl" aria-label="Job progress" />
					</Stack>
				)}

				{job.error !== undefined && job.status === "error" && (
					<Text fz="xs" c="red">
						{job.error}
					</Text>
				)}
			</Stack>
		</Paper>
	);
};
