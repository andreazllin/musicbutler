/** Small typed-array helpers (docs/lyrics-sync-functionality-implementation-plan.md §4). */

export function deinterleave(interleaved: Float32Array, channels: number): Float32Array[] {
	const frames = Math.floor(interleaved.length / channels);
	const out = Array.from({ length: channels }, () => new Float32Array(frames));
	for (let i = 0; i < frames; i++) {
		const off = i * channels;
		for (let c = 0; c < channels; c++) (out[c] as Float32Array)[i] = interleaved[off + c] as number;
	}
	return out;
}

export function interleave(channels: Float32Array[]): Float32Array {
	const n = channels[0]?.length ?? 0;
	const c = channels.length;
	const out = new Float32Array(n * c);
	for (let i = 0; i < n; i++)
		for (let k = 0; k < c; k++) out[i * c + k] = (channels[k] as Float32Array)[i] as number;
	return out;
}

/** Average of all channels (docs/PLAN.md §13.12: average L and R, then resample). */
export function downmixToMono(channels: Float32Array[]): Float32Array {
	if (channels.length === 1) return channels[0] as Float32Array;
	const n = channels[0]?.length ?? 0;
	const out = new Float32Array(n);
	const inv = 1 / channels.length;
	for (let i = 0; i < n; i++) {
		let s = 0;
		for (const ch of channels) s += ch[i] as number;
		out[i] = s * inv;
	}
	return out;
}

/** Zero-pads (or truncates) to `n` samples. Returns `x` unchanged when the length already matches. */
export function padTo(x: Float32Array, n: number): Float32Array {
	if (x.length === n) return x;
	const out = new Float32Array(n);
	out.set(x.length > n ? x.subarray(0, n) : x);
	return out;
}

export function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

export function rms(x: Float32Array): number {
	let s = 0;
	for (let i = 0; i < x.length; i++) s += (x[i] as number) * (x[i] as number);
	return Math.sqrt(s / Math.max(1, x.length));
}
