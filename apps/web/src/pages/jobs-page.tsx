import { Alert, Box, Button, Center, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { isActiveJob, type JobSummary } from "@musicbutler/shared";
import { IconAlertTriangle, IconListCheck } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { type FunctionComponent, useEffect, useState } from "react";
import { JobRow } from "@/features/jobs/components/JobRow";
import { activeCount, sortForDisplay } from "@/features/jobs/helpers/queue";
import { useCancelJob, useClearFinishedJobs, useJobs } from "@/features/jobs/hooks/use-jobs";
import { jobKindUi } from "@/features/jobs/registry";

/** How often the run-time counters move while a job is on the screen. */
const TICK_MS = 1000;

/**
 * The Sync queue screen (docs/PLAN.md §7.1). It shows every job the server
 * holds: the one that runs, the ones that wait, and the ones that finished.
 * The server pushes the list, so this screen does not poll.
 */
export const JobsPage: FunctionComponent = () => {
	const navigate = useNavigate();
	const { jobs, isPending, isError } = useJobs();
	const { cancel, pendingId } = useCancelJob();
	const clearFinished = useClearFinishedJobs();

	// Only the elapsed labels need this clock, and only while a job is active.
	const hasActive = jobs.some((job) => isActiveJob(job.status));
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!hasActive) return;
		const timer = setInterval(() => setNow(Date.now()), TICK_MS);
		return () => clearInterval(timer);
	}, [hasActive]);

	const ordered = sortForDisplay(jobs);
	const active = activeCount(jobs);
	const finished = jobs.length - active;

	// The queue does not know where a job of a given kind is edited. Its kind does.
	const openJob = (job: JobSummary) => {
		const link = jobKindUi(job.kind).linkTo(job.ref);
		if (link !== null) void navigate(link);
	};

	let queuePosition = 0;

	return (
		<Stack gap={0} h="100%" mih={0}>
			<Group
				justify="space-between"
				px="md"
				py="sm"
				style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
			>
				<Text component="h1" fz="sm" fw={500} m={0}>
					Sync queue
				</Text>
				<Group gap="sm">
					<Text fz="sm" c="dimmed">
						{active === 0
							? "No job runs now"
							: `${active} job${active === 1 ? "" : "s"} in the queue`}
					</Text>
					{finished > 0 && (
						<Button
							size="compact-sm"
							variant="default"
							loading={clearFinished.isPending}
							onClick={clearFinished.clear}
						>
							Clear finished
						</Button>
					)}
				</Group>
			</Group>

			<Box flex={1} mih={0} p="md" style={{ overflowY: "auto" }}>
				{isError ? (
					<Alert
						color="red"
						icon={<IconAlertTriangle size={18} />}
						title="The app cannot read the queue"
					>
						Reload the page. If the problem stays, look at the server log.
					</Alert>
				) : isPending ? (
					<Text fz="sm" c="dimmed">
						Please wait.
					</Text>
				) : ordered.length === 0 ? (
					<NoJobs />
				) : (
					<Stack gap="sm">
						{ordered.map((job) => {
							if (job.status === "queued") queuePosition += 1;
							return (
								<JobRow
									key={job.id}
									job={job}
									queuePosition={job.status === "queued" ? queuePosition : null}
									now={now}
									onCancel={cancel}
									isCancelling={pendingId === job.id}
									onOpen={openJob}
								/>
							);
						})}
					</Stack>
				)}
			</Box>
		</Stack>
	);
};

/** Shown when the server holds no job at all. */
const NoJobs: FunctionComponent = () => (
	<Center h="100%" mih={240}>
		<Stack align="center" gap="xs" maw={460}>
			<ThemeIcon size={56} radius="xl" variant="light">
				<IconListCheck size={28} />
			</ThemeIcon>
			<Text component="h2" fz="lg" fw={600} m={0}>
				The queue is empty
			</Text>
			<Text fz="sm" c="dimmed" ta="center">
				Open a song in Lyrics Sync and select Sync lyrics. The job shows here. You can start more
				than one job. The server runs them one at a time, in the order you send them.
			</Text>
		</Stack>
	</Center>
);
