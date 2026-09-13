import { Box, Button, Code, Flex, Group, Paper, Stack, Text } from "@mantine/core";
import { shiftTimestamps } from "@musicbutler/lrc";
import type { Lang } from "@musicbutler/shared";
import { IconDeviceFloppy, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { type FunctionComponent, useCallback, useEffect, useRef, useState } from "react";
import { AudioPlayer } from "@/features/lyrics-sync/components/AudioPlayer";
import { ColumnResizer } from "@/features/lyrics-sync/components/ColumnResizer";
import { ConfirmDialog } from "@/features/lyrics-sync/components/ConfirmDialog";
import { EditorHeader } from "@/features/lyrics-sync/components/EditorHeader";
import { FileTree, SurfaceError } from "@/features/lyrics-sync/components/FileTree";
import { LanguageSelect } from "@/features/lyrics-sync/components/LanguageSelect";
import { LrcEditor, type LrcEditorHandle } from "@/features/lyrics-sync/components/LrcEditor";
import { LyricPreview } from "@/features/lyrics-sync/components/LyricPreview";
import { NoSongSelected } from "@/features/lyrics-sync/components/NoSongSelected";
import { SyncButton } from "@/features/lyrics-sync/components/SyncButton";
import { SyncConfirmDialog } from "@/features/lyrics-sync/components/SyncConfirmDialog";
import { SyncProgress } from "@/features/lyrics-sync/components/SyncProgress";
import { parentDirOf } from "@/features/lyrics-sync/helpers/paths";
import { useLanguages } from "@/features/lyrics-sync/hooks/use-languages";
import { useLrcFile } from "@/features/lyrics-sync/hooks/use-lrc-file";
import { saveErrorMessage, useSaveLrc } from "@/features/lyrics-sync/hooks/use-save-lrc";
import { useSelectedSong } from "@/features/lyrics-sync/hooks/use-selected-song";
import { useSyncJob } from "@/features/lyrics-sync/hooks/use-sync-job";
import { mediaStreamUrl } from "@/lib/axios";
import { notify } from "@/lib/notify";
import { useTRPC, useTRPCClient } from "@/lib/trpc";
import { useLyricsSyncStore } from "@/stores/lyrics-sync-store";

const TREE_MIN = 220;
const TREE_MAX = 640;

/**
 * The Lyrics Sync screen (docs/PLAN.md §7.3): the library tree on the left, the
 * editor, the sync checker and the action row on the right. Server data lives in
 * TanStack Query, the selected song in the URL, everything else in the store.
 */
export const LyricsSyncPage: FunctionComponent = () => {
	const trpc = useTRPC();
	const trpcClient = useTRPCClient();
	const queryClient = useQueryClient();
	const [song, setSong] = useSelectedSong();
	const lrc = useLrcFile(song);
	const save = useSaveLrc();
	const languages = useLanguages();

	const buffer = useLyricsSyncStore((s) => s.buffer);
	const bufferPath = useLyricsSyncStore((s) => s.bufferPath);
	const setBuffer = useLyricsSyncStore((s) => s.setBuffer);
	const clearBuffer = useLyricsSyncStore((s) => s.clearBuffer);
	const pendingSwitch = useLyricsSyncStore((s) => s.pendingSwitch);
	const setPendingSwitch = useLyricsSyncStore((s) => s.setPendingSwitch);
	const confirmSyncOpen = useLyricsSyncStore((s) => s.confirmSyncOpen);
	const setConfirmSyncOpen = useLyricsSyncStore((s) => s.setConfirmSyncOpen);
	const conflictOpen = useLyricsSyncStore((s) => s.conflictOpen);
	const setConflictOpen = useLyricsSyncStore((s) => s.setConflictOpen);
	const deleteOpen = useLyricsSyncStore((s) => s.deleteOpen);
	const setDeleteOpen = useLyricsSyncStore((s) => s.setDeleteOpen);
	const isolateVocals = useLyricsSyncStore((s) => s.isolateVocals);
	const wordTimestamps = useLyricsSyncStore((s) => s.wordTimestamps);
	const setPreviewOffset = useLyricsSyncStore((s) => s.setPreviewOffset);

	const [treeWidth, setTreeWidth] = useState(320);
	const [duration, setDuration] = useState<number | undefined>(undefined);
	const [lang, setLang] = useState<Lang | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const editorRef = useRef<LrcEditorHandle | null>(null);

	// Default to the first available language (docs/PLAN.md §7.5).
	useEffect(() => {
		if (lang !== null || !languages.data) return;
		const first = languages.data.langs.find((l) => l.available) ?? languages.data.langs[0];
		if (first) setLang(first.code);
	}, [lang, languages.data]);

	const savedContent = lrc.data?.content ?? "";
	const bufferActive = song !== null && buffer !== null && bufferPath === song;
	const editorText = bufferActive ? buffer : savedContent;
	const dirty = bufferActive && buffer !== savedContent;
	const songSelected = song !== null;

	/** Writes the given content into the lrc.get cache so the editor never flashes stale text. */
	const primeLrcCache = useCallback(
		(audioPath: string, content: string, mtimeMs: number | null) => {
			queryClient.setQueryData(trpc.lrc.get.queryKey({ audioPath }), (old) =>
				old
					? { ...old, content, mtimeMs, exists: mtimeMs !== null }
					: { lrcPath: "", content, mtimeMs, exists: mtimeMs !== null },
			);
		},
		[queryClient, trpc],
	);

	const sync = useSyncJob({
		onDone: ({ content, mtimeMs }) => {
			if (!song) return;
			editorRef.current?.replaceText(content);
			primeLrcCache(song, content, mtimeMs);
			clearBuffer();
			void queryClient.invalidateQueries({ queryKey: trpc.lrc.get.queryKey({ audioPath: song }) });
			void queryClient.invalidateQueries({
				queryKey: trpc.library.list.queryKey({ path: parentDirOf(song) }),
			});
			notify.success("Lyrics synced and saved");
		},
		onError: ({ code, message }) => {
			if (code === "CANCELLED") notify.info("Sync cancelled. The file was left untouched.");
			else notify.error(message);
		},
	});

	const selectSong = (path: string | null) => {
		clearBuffer();
		setPreviewOffset(0);
		void setSong(path);
	};
	/** Applies the unsaved-changes guard. `null` clears the selection. */
	const requestSelect = (path: string | null) => {
		if (path === song) return;
		if (dirty) setPendingSwitch({ toPath: path });
		else selectSong(path);
	};

	const doSave = (content: string, expectedMtimeMs: number | null) => {
		if (!song) return;
		save.mutate(
			{ audioPath: song, content, expectedMtimeMs },
			{
				onSuccess: (result) => {
					primeLrcCache(song, result.action === "deleted" ? "" : content, result.mtimeMs);
					clearBuffer();
					setConflictOpen(false);
					setDeleteOpen(false);
				},
				onError: (error) => {
					if (error.data?.code === "CONFLICT") setConflictOpen(true);
				},
			},
		);
	};
	const onSave = () => doSave(editorText, lrc.data?.mtimeMs ?? null);
	const onOverwrite = async () => {
		if (!song) return;
		try {
			const fresh = await trpcClient.lrc.get.query({ audioPath: song });
			doSave(editorText, fresh.mtimeMs);
		} catch (error) {
			notify.error(error instanceof Error ? error.message : "Could not read the file.");
		}
	};
	const onReload = () => {
		clearBuffer();
		setConflictOpen(false);
		void lrc.refetch();
	};

	const startSync = () => {
		if (!song || !lang) return;
		setConfirmSyncOpen(false);
		sync.start({
			audioPath: song,
			lyrics: editorText,
			lang,
			options: { isolateVocals, wordTimestamps },
		});
	};

	const applyOffset = (offset: number) => {
		if (!song) return;
		const next = shiftTimestamps(editorText, offset);
		// One transaction, so the editor's undo reverses the whole shift.
		editorRef.current?.replaceText(next);
		setBuffer(song, next);
	};

	return (
		<Flex h="100%" w="100%" mih={0}>
			<Box
				component="aside"
				w={treeWidth}
				h="100%"
				style={{
					flexShrink: 0,
					borderRight: "1px solid var(--mantine-color-default-border)",
				}}
			>
				<FileTree selectedPath={song} onSelectAudio={requestSelect} />
			</Box>
			<ColumnResizer
				width={treeWidth}
				min={TREE_MIN}
				max={TREE_MAX}
				onChange={setTreeWidth}
				label="Resize library column"
			/>

			<Flex component="section" direction="column" flex={1} miw={0}>
				<EditorHeader
					songPath={song}
					dirty={dirty}
					lrcExists={lrc.data?.exists}
					onClear={() => requestSelect(null)}
				/>

				{!songSelected ? (
					<NoSongSelected />
				) : (
					<Stack gap="sm" flex={1} mih={0} p="md">
						{lrc.isError ? (
							<SurfaceError
								title="The lyrics file could not be read"
								detail={lrc.error.message}
								onRetry={() => void lrc.refetch()}
							/>
						) : (
							<LrcEditor
								handleRef={editorRef}
								value={editorText}
								onChange={(text) => {
									if (song) setBuffer(song, text);
								}}
								disabled={lrc.isPending || sync.isRunning}
								durationSeconds={duration}
								placeholder="Paste or type the lyrics here, then press Sync lyrics to generate timestamps."
							/>
						)}

						<Paper withBorder h="38%" mih={224} style={{ overflow: "hidden" }}>
							<Stack gap={0} h="100%">
								<Box style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
									<AudioPlayer
										src={mediaStreamUrl(song)}
										audioRef={audioRef}
										onDurationChange={setDuration}
									/>
								</Box>
								<LyricPreview text={editorText} audioRef={audioRef} onApplyOffset={applyOffset} />
							</Stack>
						</Paper>

						{sync.progress && <SyncProgress progress={sync.progress} />}

						<Group gap="md" wrap="wrap">
							<Button
								leftSection={<IconDeviceFloppy size={18} />}
								disabled={!dirty || sync.isRunning}
								loading={save.isPending}
								onClick={onSave}
							>
								Save
							</Button>
							<LanguageSelect value={lang} onChange={setLang} isDisabled={sync.isRunning} />
							<SyncButton
								editorText={editorText}
								jobRunning={sync.isRunning}
								onRequestSync={(needsConfirm) => {
									if (needsConfirm) setConfirmSyncOpen(true);
									else startSync();
								}}
								onCancel={sync.cancel}
								isCancelling={sync.isCancelling}
							/>
							<Button
								ml="auto"
								variant="default"
								color="red"
								leftSection={<IconTrash size={18} />}
								disabled={sync.isRunning || (!lrc.data?.exists && !dirty)}
								onClick={() => setDeleteOpen(true)}
							>
								Delete lyrics
							</Button>
						</Group>
					</Stack>
				)}
			</Flex>

			<SyncConfirmDialog
				isOpen={confirmSyncOpen}
				onOpenChange={setConfirmSyncOpen}
				onConfirm={startSync}
			/>

			<ConfirmDialog
				isOpen={pendingSwitch !== null}
				onOpenChange={(open) => {
					if (!open) setPendingSwitch(null);
				}}
				title="Discard unsaved changes?"
				confirmLabel={pendingSwitch?.toPath === null ? "Discard and close" : "Discard and switch"}
				confirmColor="red"
				onConfirm={() => {
					const to = pendingSwitch?.toPath ?? null;
					setPendingSwitch(null);
					selectSong(to);
				}}
			>
				<Text fz="sm">
					The lyrics for the current song have unsaved edits. Leaving this song throws them away.
				</Text>
			</ConfirmDialog>

			<ConfirmDialog
				isOpen={conflictOpen}
				onOpenChange={setConflictOpen}
				title="The file changed on disk"
				confirmLabel="Overwrite"
				confirmColor="red"
				onConfirm={() => void onOverwrite()}
				isConfirming={save.isPending}
				secondaryAction={
					<Button variant="default" onClick={onReload}>
						Reload from disk
					</Button>
				}
			>
				<Text fz="sm">
					Someone else saved this <Code>.lrc</Code> file since you loaded it. Reload to see their
					version and lose your edits, or overwrite it with yours.
				</Text>
			</ConfirmDialog>

			<ConfirmDialog
				isOpen={deleteOpen}
				onOpenChange={setDeleteOpen}
				title="Delete the lyrics file?"
				confirmLabel="Delete"
				confirmColor="red"
				onConfirm={() => doSave("", lrc.data?.mtimeMs ?? null)}
				isConfirming={save.isPending}
			>
				<Text fz="sm">
					This clears the editor and removes the <Code>.lrc</Code> file from the library. The audio
					file is not touched.
				</Text>
				{save.isError && save.error.data?.code !== "CONFLICT" && (
					<Text fz="sm" c="red">
						{saveErrorMessage(save.error)}
					</Text>
				)}
			</ConfirmDialog>
		</Flex>
	);
};
