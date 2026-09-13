import { ActionIcon, Box, Group, SegmentedControl, Slider, Text, Tooltip } from "@mantine/core";
import {
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
	IconVolume,
	IconVolumeOff,
} from "@tabler/icons-react";
import {
	type FunctionComponent,
	type KeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { formatClock } from "@/lib/format";
import { useLyricsSyncStore } from "@/stores/lyrics-sync-store";
import { PLAYBACK_RATES, SEEK_STEP_SECONDS } from "../constants";
import { useAudioClock } from "../hooks/use-audio-clock";

/** A slider value that is safe to store; NaN and undefined become 0. */
function sliderValue(v: number): number {
	return Number.isFinite(v) ? v : 0;
}

type Props = {
	/** Stream URL, or null while no song is selected. */
	src: string | null;
	audioRef: RefObject<HTMLAudioElement | null>;
	onDurationChange: (seconds: number | undefined) => void;
};

/**
 * The sync checker's player (docs/PLAN.md §7.6): play/pause, seek bar, `mm:ss.xx`
 * readout, volume and speeds 0.75x, 1x, 1.25x. Keys work only while the player
 * holds focus: Space toggles, ← and → seek by 2 s.
 */
export const AudioPlayer: FunctionComponent<Props> = ({ src, audioRef, onDurationChange }) => {
	const [time, setTime] = useState(0);
	const [duration, setDuration] = useState<number | undefined>(undefined);
	const [playing, setPlaying] = useState(false);
	const volume = useLyricsSyncStore((s) => s.volume);
	const setVolume = useLyricsSyncStore((s) => s.setVolume);
	const playbackRate = useLyricsSyncStore((s) => s.playbackRate);
	const setPlaybackRate = useLyricsSyncStore((s) => s.setPlaybackRate);
	const lastPaint = useRef(0);

	// The slider needs no 60 Hz updates; ~15 Hz keeps it smooth and cheap.
	const onTick = useCallback((t: number) => {
		const now = performance.now();
		if (now - lastPaint.current > 66) {
			lastPaint.current = now;
			setTime(t);
		}
	}, []);
	useAudioClock(audioRef, onTick);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		const onMeta = () => {
			const d = Number.isFinite(audio.duration) ? audio.duration : undefined;
			setDuration(d);
			onDurationChange(d);
		};
		const onPlay = () => setPlaying(true);
		const onPause = () => setPlaying(false);
		const onEmptied = () => {
			setDuration(undefined);
			onDurationChange(undefined);
			setTime(0);
			setPlaying(false);
		};
		audio.addEventListener("loadedmetadata", onMeta);
		audio.addEventListener("durationchange", onMeta);
		audio.addEventListener("play", onPlay);
		audio.addEventListener("pause", onPause);
		audio.addEventListener("ended", onPause);
		audio.addEventListener("emptied", onEmptied);
		// The metadata may already be there when the listeners attach (fast cache hit).
		if (audio.readyState >= 1) onMeta();
		return () => {
			audio.removeEventListener("loadedmetadata", onMeta);
			audio.removeEventListener("durationchange", onMeta);
			audio.removeEventListener("play", onPlay);
			audio.removeEventListener("pause", onPause);
			audio.removeEventListener("ended", onPause);
			audio.removeEventListener("emptied", onEmptied);
		};
	}, [audioRef, onDurationChange]);

	useEffect(() => {
		const audio = audioRef.current;
		if (audio && Number.isFinite(volume)) audio.volume = Math.min(1, Math.max(0, volume));
	}, [audioRef, volume]);
	useEffect(() => {
		const audio = audioRef.current;
		if (audio) audio.playbackRate = playbackRate;
	}, [audioRef, playbackRate]);

	const toggle = () => {
		const audio = audioRef.current;
		if (!audio || !src) return;
		if (audio.paused) void audio.play().catch(() => setPlaying(false));
		else audio.pause();
	};
	const seekTo = (t: number) => {
		const audio = audioRef.current;
		if (!audio) return;
		const max = Number.isFinite(audio.duration) ? audio.duration : t;
		audio.currentTime = Math.min(Math.max(0, t), max);
		setTime(audio.currentTime);
	};
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		// Let the sliders keep their own arrow-key handling.
		if ((e.target as HTMLElement).getAttribute("role") === "slider") return;
		if (e.key === " ") {
			e.preventDefault();
			toggle();
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			seekTo((audioRef.current?.currentTime ?? 0) - SEEK_STEP_SECONDS);
		} else if (e.key === "ArrowRight") {
			e.preventDefault();
			seekTo((audioRef.current?.currentTime ?? 0) + SEEK_STEP_SECONDS);
		}
	};

	const disabled = src === null;

	return (
		// No border or surface of its own: the player is the header row of the sync
		// checker card, which already draws both.
		<Box
			role="group"
			aria-label="Audio player"
			// The group must hold focus for Space, ← and → (docs/PLAN.md §7.6).
			tabIndex={0}
			onKeyDown={onKeyDown}
			px="sm"
			py={8}
		>
			<Group gap="md" wrap="nowrap">
				{/* biome-ignore lint/a11y/useMediaCaption: music has no captions; the lyric preview is the transcript */}
				<audio ref={audioRef} src={src ?? undefined} preload="metadata" />
				<Tooltip label={playing ? "Pause (Space)" : "Play (Space)"} withArrow>
					<ActionIcon
						size="lg"
						variant="default"
						aria-label={playing ? "Pause" : "Play"}
						disabled={disabled}
						onClick={toggle}
					>
						{playing ? <IconPlayerPauseFilled size={18} /> : <IconPlayerPlayFilled size={18} />}
					</ActionIcon>
				</Tooltip>
				<Text fz="xs" ff="monospace" c="dimmed" w={120} style={{ flexShrink: 0 }}>
					{formatClock(time)} / {duration === undefined ? "--:--.--" : formatClock(duration)}
				</Text>
				<Box flex={1} miw={160}>
					<Slider
						label={formatClock}
						thumbLabel="Seek"
						min={0}
						max={duration ?? 1}
						step={0.01}
						value={Math.min(time, duration ?? 1)}
						onChange={(v) => seekTo(sliderValue(v))}
						disabled={disabled || duration === undefined}
						size="sm"
					/>
				</Box>
				<Group gap="xs" wrap="nowrap" w={150}>
					<ActionIcon
						size="md"
						variant="subtle"
						color="gray"
						aria-label={volume === 0 ? "Unmute" : "Mute"}
						onClick={() => setVolume(volume === 0 ? 1 : 0)}
					>
						{volume === 0 ? <IconVolumeOff size={16} /> : <IconVolume size={16} />}
					</ActionIcon>
					<Box flex={1} miw={0}>
						<Slider
							label={(v) => `${Math.round(v * 100)}%`}
							thumbLabel="Volume"
							min={0}
							max={1}
							step={0.01}
							value={volume}
							onChange={(v) => setVolume(sliderValue(v))}
							size="sm"
						/>
					</Box>
				</Group>
				<SegmentedControl
					aria-label="Playback speed"
					size="xs"
					value={String(playbackRate)}
					onChange={(value) => setPlaybackRate(Number(value))}
					data={PLAYBACK_RATES.map((rate) => ({ value: String(rate), label: `${rate}x` }))}
				/>
			</Group>
		</Box>
	);
};
