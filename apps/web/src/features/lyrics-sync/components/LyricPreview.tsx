import { Box, Button, Group, Slider, Stack, Text } from "@mantine/core";
import { parse } from "@musicbutler/lrc";
import {
	type FunctionComponent,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useLyricsSyncStore } from "@/stores/lyrics-sync-store";
import {
	AUTOSCROLL_SUSPEND_MS,
	OFFSET_MAX_SECONDS,
	OFFSET_MIN_SECONDS,
	OFFSET_STEP_SECONDS,
} from "../constants";
import { findActiveLine } from "../helpers/active-line";
import { useAudioClock } from "../hooks/use-audio-clock";
import classes from "./LyricPreview.module.css";

type Props = {
	/** The editor text; the preview follows unsaved edits. */
	text: string;
	audioRef: RefObject<HTMLAudioElement | null>;
	/** Shifts every timestamp in the editor by the current preview offset. */
	onApplyOffset: (offsetSeconds: number) => void;
};

/**
 * Parsed lines with the active one highlighted (docs/PLAN.md §7.6). The highlight
 * runs off requestAnimationFrame through `useAudioClock`; the active line comes
 * from a binary search. Clicking a line seeks. Auto-scroll keeps the active line
 * centered and pauses for 3 s after a manual scroll.
 */
export const LyricPreview: FunctionComponent<Props> = ({ text, audioRef, onApplyOffset }) => {
	const offset = useLyricsSyncStore((s) => s.previewOffset);
	const setOffset = useLyricsSyncStore((s) => s.setPreviewOffset);
	const lines = useMemo(() => {
		const doc = parse(text);
		return [...doc.lines].sort((a, b) => a.time - b.time);
	}, [text]);
	// Effective times: the preview offset applies at preview time only.
	const times = useMemo(() => Float64Array.from(lines, (l) => l.time + offset), [lines, offset]);
	const [active, setActive] = useState(-1);
	const activeRef = useRef(-1);
	const listRef = useRef<HTMLOListElement>(null);
	const suspendedUntil = useRef(0);
	const programmatic = useRef(false);

	const onTick = useCallback(
		(t: number) => {
			const idx = findActiveLine(times, t);
			if (idx !== activeRef.current) {
				activeRef.current = idx;
				setActive(idx);
			}
		},
		[times],
	);
	useAudioClock(audioRef, onTick);

	useEffect(() => {
		if (active < 0 || performance.now() < suspendedUntil.current) return;
		const el = listRef.current?.children[active];
		if (!(el instanceof HTMLElement)) return;
		programmatic.current = true;
		el.scrollIntoView({ block: "center", behavior: "smooth" });
		const id = window.setTimeout(() => {
			programmatic.current = false;
		}, 600);
		return () => window.clearTimeout(id);
	}, [active]);

	const onScroll = () => {
		if (programmatic.current) return;
		suspendedUntil.current = performance.now() + AUTOSCROLL_SUSPEND_MS;
	};

	const seek = (t: number) => {
		const audio = audioRef.current;
		if (!audio) return;
		audio.currentTime = Math.max(0, t);
	};

	return (
		<Stack gap={0} flex={1} miw={0} mih={0}>
			<ol ref={listRef} onScroll={onScroll} aria-label="Lyric preview" className={classes.list}>
				{lines.length === 0 ? (
					<Box component="li" py="lg" ta="center" fz="sm" c="dimmed">
						There are no timed lines. Write lyrics with [mm:ss.xx] tags, or select Sync lyrics.
					</Box>
				) : (
					lines.map((line, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: repeated lines share time and text
						<li key={`${line.time}-${i}`}>
							<button
								type="button"
								onClick={() => seek(times[i] ?? 0)}
								className={[
									classes.line,
									i === active && classes.active,
									i < active && classes.past,
								]
									.filter(Boolean)
									.join(" ")}
							>
								{line.text || "♪"}
							</button>
						</li>
					))
				)}
			</ol>
			<Group
				gap="md"
				wrap="nowrap"
				px="sm"
				py="xs"
				style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
			>
				<Text fz="xs" fw={500} style={{ flexShrink: 0 }}>
					Offset
				</Text>
				<Box flex={1}>
					<Slider
						thumbLabel="Preview offset in seconds"
						label={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} s`}
						min={OFFSET_MIN_SECONDS}
						max={OFFSET_MAX_SECONDS}
						step={OFFSET_STEP_SECONDS}
						value={offset}
						onChange={(v) => {
							if (Number.isFinite(v)) setOffset(v);
						}}
						size="sm"
					/>
				</Box>
				<Text fz="xs" ff="monospace" c="dimmed" w={64} ta="right" style={{ flexShrink: 0 }}>
					{offset >= 0 ? "+" : ""}
					{offset.toFixed(2)} s
				</Text>
				<Button
					size="xs"
					variant="default"
					disabled={offset === 0}
					onClick={() => {
						onApplyOffset(offset);
						setOffset(0);
					}}
				>
					Apply offset to document
				</Button>
			</Group>
		</Stack>
	);
};
