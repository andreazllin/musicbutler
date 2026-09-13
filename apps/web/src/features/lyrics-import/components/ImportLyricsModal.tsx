import {
	Alert,
	Badge,
	Button,
	Group,
	Modal,
	Paper,
	ScrollArea,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import {
	LYRICS_PROVIDER_LABELS,
	type LyricsCandidate,
	type LyricsProvider,
} from "@musicbutler/shared";
import { IconAlertTriangle, IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { type FunctionComponent, useEffect, useState } from "react";
import { formatClock } from "@/lib/format";
import { notify } from "@/lib/notify";
import { useTRPC, useTRPCClient } from "@/lib/trpc";
import { guessFromPath } from "../helpers/guess";

const PROVIDER_COLORS: Record<LyricsProvider, string> = {
	lrclib: "grape",
	genius: "yellow",
	azlyrics: "cyan",
};

export type ImportedLyrics = { text: string; synced: boolean; source: LyricsProvider };

type Props = {
	isOpen: boolean;
	onClose: () => void;
	/** Library path of the open song. The search fields start from it. */
	audioPath: string;
	/** Length from the player. LRCLIB matches on it, so it finds the exact record. */
	durationSec?: number;
	onImport: (result: ImportedLyrics) => void;
};

/**
 * Searches the lyrics providers and puts one result in the editor
 * (docs/PLAN.md §6.2 `lyrics.*`).
 *
 * Nothing here writes to the library. The words land in the editor and the user
 * saves them, so a wrong result costs one undo and not a damaged file.
 */
export const ImportLyricsModal: FunctionComponent<Props> = ({
	isOpen,
	onClose,
	audioPath,
	durationSec,
	onImport,
}) => {
	const trpc = useTRPC();
	const client = useTRPCClient();
	const [fields, setFields] = useState(() => guessFromPath(audioPath));
	const [submitted, setSubmitted] = useState<typeof fields | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);

	// A different song means a different guess. Reset when the dialog opens.
	useEffect(() => {
		if (!isOpen) return;
		setFields(guessFromPath(audioPath));
		setSubmitted(null);
		setBusyId(null);
	}, [isOpen, audioPath]);

	const search = useQuery({
		...trpc.lyrics.search.queryOptions({
			artist: submitted?.artist ?? "",
			title: submitted?.title ?? "",
			album: submitted?.album || undefined,
			durationSec: durationSec !== undefined ? Math.round(durationSec) : undefined,
		}),
		enabled: submitted !== null && submitted.title.trim() !== "",
		retry: false,
	});

	const use = async (candidate: LyricsCandidate) => {
		setBusyId(candidate.id);
		try {
			const result = await client.lyrics.fetch.query({
				provider: candidate.provider,
				id: candidate.id,
			});
			// Timestamps are the whole point of a synced record: take them and the
			// user can skip the sync step.
			const synced = result.synced !== null && result.synced.trim() !== "";
			onImport({
				text: synced ? (result.synced as string) : result.plain,
				synced,
				source: candidate.provider,
			});
			onClose();
		} catch (error) {
			notify.error(error instanceof Error ? error.message : "The app could not read those lyrics.");
		} finally {
			setBusyId(null);
		}
	};

	const candidates = search.data?.candidates ?? [];
	const failures = search.data?.failures ?? [];

	return (
		<Modal opened={isOpen} onClose={onClose} title="Import lyrics" size="lg" centered>
			<Stack gap="md">
				<Text fz="sm" c="dimmed">
					The app reads no tags from the audio file, so these fields come from the path. Correct
					them if they are wrong, then search.
				</Text>

				<Group grow align="flex-start">
					<TextInput
						label="Artist"
						value={fields.artist}
						onChange={(event) => setFields({ ...fields, artist: event.currentTarget.value })}
					/>
					<TextInput
						label="Title"
						required
						value={fields.title}
						onChange={(event) => setFields({ ...fields, title: event.currentTarget.value })}
					/>
				</Group>

				<Group align="flex-end" gap="sm">
					<TextInput
						label="Album"
						flex={1}
						description="Optional. It helps LRCLIB find the exact record."
						value={fields.album}
						onChange={(event) => setFields({ ...fields, album: event.currentTarget.value })}
					/>
					<Button
						leftSection={<IconSearch size={18} />}
						loading={search.isFetching}
						disabled={fields.title.trim() === ""}
						onClick={() => setSubmitted({ ...fields })}
					>
						Search
					</Button>
				</Group>

				{search.isError && (
					<Alert color="red" icon={<IconAlertTriangle size={18} />}>
						{search.error.message || "The search failed."}
					</Alert>
				)}

				{failures.length > 0 && (
					<Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Some sources failed">
						<Stack gap={2}>
							{failures.map((failure) => (
								<Text key={failure.provider} fz="xs">
									{LYRICS_PROVIDER_LABELS[failure.provider]}: {failure.message}
								</Text>
							))}
						</Stack>
					</Alert>
				)}

				{submitted !== null && !search.isFetching && candidates.length === 0 && !search.isError && (
					<Text fz="sm" c="dimmed">
						No source has this song. Correct the artist or the title and search again.
					</Text>
				)}

				{candidates.length > 0 && (
					<ScrollArea.Autosize mah={320}>
						<Stack gap="xs">
							{candidates.map((candidate) => (
								<Paper key={`${candidate.provider}:${candidate.id}`} withBorder p="sm">
									<Group justify="space-between" wrap="nowrap" gap="sm">
										<Stack gap={2} miw={0} flex={1}>
											<Text fw={500} truncate="end">
												{candidate.title}
											</Text>
											<Text fz="xs" c="dimmed" truncate="end">
												{candidate.artist}
												{candidate.album ? ` — ${candidate.album}` : ""}
												{candidate.durationSec !== undefined
													? ` — ${formatClock(candidate.durationSec)}`
													: ""}
											</Text>
										</Stack>
										<Group gap="xs" wrap="nowrap">
											<Badge variant="light" color={PROVIDER_COLORS[candidate.provider]}>
												{LYRICS_PROVIDER_LABELS[candidate.provider]}
											</Badge>
											{candidate.synced && (
												<Badge variant="light" color="teal">
													Timed
												</Badge>
											)}
											<Button
												size="compact-sm"
												variant="default"
												loading={busyId === candidate.id}
												onClick={() => void use(candidate)}
											>
												Use
											</Button>
										</Group>
									</Group>
								</Paper>
							))}
						</Stack>
					</ScrollArea.Autosize>
				)}
			</Stack>
		</Modal>
	);
};
