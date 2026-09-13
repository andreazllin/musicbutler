import {
	ActionIcon,
	Box,
	Group,
	Paper,
	Progress,
	Stack,
	Text,
	ThemeIcon,
	Tooltip,
} from "@mantine/core";
import { isActiveJob, type JobStatus, type JobSummary } from "@musicbutler/shared";
import { IconArrowRight, IconX } from "@tabler/icons-react";
import type { FunctionComponent } from "react";
import { elapsedLabel } from "../helpers/queue";
import { jobKindUi } from "../registry";

/** One colour per state, used by the icon and by the state line. */
const STATUS_COLORS: Record<JobStatus, string> = {
	queued: "gray",
	running: "blue",
	done: "teal",
	error: "red",
	cancelled: "gray",
};

const TERMINAL_LABELS: Record<string, string> = {
	done: "Done",
	error: "Failed",
	cancelled: "Cancelled",
};

type Props = {
	job: JobSummary;
	/** Place in the queue, 1 for the next job to start. Null in the other states. */
	queuePosition: number | null;
	now: number;
	onCancel: (jobId: string) => void;
	isCancelling: boolean;
	onOpen: (job: JobSummary) => void;
};

/**
 * One job in the queue.
 *
 * The row reads in one line per level: what the job works on, then where that
 * sits, then what the job does right now. Only the state line carries colour,
 * so a failed job stands out in a list of finished ones. The kind of work is an
 * icon rather than a word, because every row in a list of one kind would
 * otherwise carry the same word.
 */
export const JobRow: FunctionComponent<Props> = ({
	job,
	queuePosition,
	now,
	onCancel,
	isCancelling,
	onOpen,
}) => {
	const kind = jobKindUi(job.kind);
	const active = isActiveJob(job.status);
	const elapsed = elapsedLabel(job, now);
	const color = STATUS_COLORS[job.status];

	// The state line: what it does now, or where it waits, or how it ended.
	const state =
		job.status === "running"
			? kind.stageLabel(job.stage)
			: job.status === "queued"
				? queuePosition !== null
					? `Waiting, no. ${queuePosition}`
					: "Waiting"
				: (TERMINAL_LABELS[job.status] ?? job.status);

	// The quiet line under it: progress and run time, only when there is any.
	const detail = [
		job.status === "running" ? `${Math.round(job.pct)}%` : null,
		job.status === "running" ? job.message : null,
		elapsed,
	]
		.filter((part): part is string => Boolean(part))
		.join(" · ");

	const context = [job.subtitle, ...(job.badges ?? [])].filter(Boolean).join(" · ");
	const canOpen = kind.linkTo(job.ref) !== null;

	return (
		<Paper withBorder p="sm">
			<Group wrap="nowrap" gap="sm" align="center">
				<Tooltip label={kind.label} withArrow position="right">
					<ThemeIcon variant="light" color={color} size={36} radius="md">
						<kind.icon size={18} />
					</ThemeIcon>
				</Tooltip>

				<Stack gap={2} miw={0} flex={1}>
					<Text fw={500} truncate="end" title={job.ref}>
						{job.title}
					</Text>
					{context !== "" && (
						<Text fz="xs" c="dimmed" truncate="end" title={context}>
							{context}
						</Text>
					)}
					{/* Narrow: the state reads under the title, because a second column
					    beside it would leave the title a few characters wide. */}
					<Box hiddenFrom="sm">
						<Group gap={6} wrap="nowrap">
							<Text fz="xs" c={job.status === "queued" ? "dimmed" : color} fw={500} truncate="end">
								{state}
							</Text>
							{detail !== "" && (
								<Text fz="xs" c="dimmed" ff="monospace" style={{ flexShrink: 0 }}>
									{detail}
								</Text>
							)}
						</Group>
					</Box>
				</Stack>

				<Stack gap={2} align="flex-end" miw={0} style={{ flexShrink: 0 }} visibleFrom="sm">
					<Text fz="sm" c={job.status === "queued" ? "dimmed" : color} fw={500}>
						{state}
					</Text>
					{detail !== "" && (
						<Text fz="xs" c="dimmed" ff="monospace">
							{detail}
						</Text>
					)}
				</Stack>

				{active ? (
					<Tooltip label="Cancel this job" withArrow>
						<ActionIcon
							variant="subtle"
							color="red"
							size="lg"
							aria-label={`Cancel ${job.title}`}
							loading={isCancelling}
							onClick={() => onCancel(job.id)}
						>
							<IconX size={18} />
						</ActionIcon>
					</Tooltip>
				) : canOpen ? (
					<Tooltip label="Open" withArrow>
						<ActionIcon
							variant="subtle"
							color="gray"
							size="lg"
							aria-label={`Open ${job.title}`}
							onClick={() => onOpen(job)}
						>
							<IconArrowRight size={18} />
						</ActionIcon>
					</Tooltip>
				) : (
					// Keeps the state lines of every row on one vertical line.
					<Box w={34} style={{ flexShrink: 0 }} visibleFrom="sm" />
				)}
			</Group>

			{job.status === "running" && (
				<Progress
					value={job.pct}
					size="xs"
					radius="xl"
					mt="xs"
					aria-label={`${job.title}: ${Math.round(job.pct)}%`}
				/>
			)}

			{job.status === "error" && job.error !== undefined && (
				<Text fz="xs" c="red" mt={6}>
					{job.error}
				</Text>
			)}
		</Paper>
	);
};
