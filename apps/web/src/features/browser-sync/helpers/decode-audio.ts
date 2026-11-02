import { ORIGINAL_SR } from "@musicbutler/align/browser";
import { mediaStreamUrl } from "@/lib/axios";

/** The browser could not read the file. The server's ffmpeg reads more formats. */
export class UnsupportedAudioError extends Error {
	override name = "UnsupportedAudioError";
}

/**
 * Fetches a song from the library and decodes it at 44.1 kHz, which is the
 * rate Demucs takes. This runs on the page, because a Web Worker has no
 * `OfflineAudioContext`. The browser decodes on a thread of its own, so the
 * page stays responsive. Returns one or two channels: a mono file stays mono,
 * and a file with more than two channels keeps its first two.
 */
export async function decodeSong(audioPath: string, signal: AbortSignal): Promise<Float32Array[]> {
	const response = await fetch(mediaStreamUrl(audioPath), { signal, credentials: "include" });
	if (!response.ok) throw new Error(`The server answered ${response.status} for the audio.`);
	const bytes = await response.arrayBuffer();
	signal.throwIfAborted();
	const context = new OfflineAudioContext(2, 1, ORIGINAL_SR);
	let audio: AudioBuffer;
	try {
		audio = await context.decodeAudioData(bytes);
	} catch {
		throw new UnsupportedAudioError(
			"This browser cannot read the audio format of this song. Set the sync to run on the server in Settings.",
		);
	}
	const channels = Math.min(2, audio.numberOfChannels);
	// Copies, because the arrays go to the worker as transferables.
	return Array.from({ length: channels }, (_, c) => audio.getChannelData(c).slice());
}
