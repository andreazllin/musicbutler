/** 16-bit PCM WAV writer (docs/lyrics-sync-functionality-implementation-plan.md §4). */
import { clamp } from "./ops.ts";

export function encodeWav16(channels: Float32Array[], sampleRate: number): Uint8Array {
	const nCh = channels.length;
	const frames = channels[0]?.length ?? 0;
	const dataBytes = frames * nCh * 2;
	const buf = new ArrayBuffer(44 + dataBytes);
	const v = new DataView(buf);
	const ascii = (off: number, s: string) => {
		for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
	};
	ascii(0, "RIFF");
	v.setUint32(4, 36 + dataBytes, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, nCh, true);
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, sampleRate * nCh * 2, true);
	v.setUint16(32, nCh * 2, true);
	v.setUint16(34, 16, true);
	ascii(36, "data");
	v.setUint32(40, dataBytes, true);
	let off = 44;
	for (let i = 0; i < frames; i++) {
		for (let c = 0; c < nCh; c++) {
			const s = clamp((channels[c] as Float32Array)[i] as number, -1, 1);
			v.setInt16(off, Math.round(s < 0 ? s * 32768 : s * 32767), true);
			off += 2;
		}
	}
	return new Uint8Array(buf);
}

export async function writeWav16(
	path: string,
	channels: Float32Array[],
	sampleRate: number,
): Promise<void> {
	await Bun.write(path, encodeWav16(channels, sampleRate));
}
