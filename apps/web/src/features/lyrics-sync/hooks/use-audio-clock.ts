import { type RefObject, useEffect } from "react";

/**
 * Calls `onTick(currentTime)` from `requestAnimationFrame` while the audio plays,
 * and once after seek, pause, load and rate changes. `timeupdate` fires about four
 * times a second and looks broken for a lyric highlight (docs/PLAN.md §7.6).
 */
export function useAudioClock(
	audioRef: RefObject<HTMLAudioElement | null>,
	onTick: (time: number) => void,
) {
	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		let frame = 0;
		const tick = () => {
			onTick(audio.currentTime);
			if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
		};
		const start = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(tick);
		};
		const once = () => onTick(audio.currentTime);
		audio.addEventListener("play", start);
		audio.addEventListener("playing", start);
		audio.addEventListener("pause", once);
		audio.addEventListener("seeked", once);
		audio.addEventListener("loadedmetadata", once);
		audio.addEventListener("emptied", once);
		if (!audio.paused) start();
		else once();
		return () => {
			cancelAnimationFrame(frame);
			audio.removeEventListener("play", start);
			audio.removeEventListener("playing", start);
			audio.removeEventListener("pause", once);
			audio.removeEventListener("seeked", once);
			audio.removeEventListener("loadedmetadata", once);
			audio.removeEventListener("emptied", once);
		};
	}, [audioRef, onTick]);
}
