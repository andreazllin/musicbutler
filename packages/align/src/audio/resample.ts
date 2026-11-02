/**
 * Band-limited resampling in plain JavaScript, for runtimes without ffmpeg.
 *
 * The server resamples with ffmpeg (`ffmpeg.ts`). A Web Worker has no ffmpeg
 * and no `OfflineAudioContext`, so the browser build resamples here. The ratio
 * of two integer rates is rational, `up / down` once reduced, so an output
 * sample only ever falls on one of `up` fractional positions between two input
 * samples. One windowed-sinc kernel per position is computed up front, and the
 * main loop is multiply-adds only: 44.1 kHz to 16 kHz is 160 kernels of 90
 * taps, about 0.5 s for a 4-minute song.
 */

function gcd(a: number, b: number): number {
	while (b !== 0) [a, b] = [b, a % b];
	return a;
}

function sinc(x: number): number {
	if (x === 0) return 1;
	const px = Math.PI * x;
	return Math.sin(px) / px;
}

/** Blackman window over `[-half, half]`, zero outside. */
function blackman(d: number, half: number): number {
	if (Math.abs(d) >= half) return 0;
	const a = (Math.PI * d) / half;
	return 0.42 + 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a);
}

/**
 * Resamples a mono signal from `from` Hz to `to` Hz. Both rates must be
 * positive integers. When downsampling, the kernel also low-passes at the new
 * Nyquist frequency, so nothing above it folds back. Returns `x` itself when
 * the rates match.
 *
 * `zeroCrossings` sets the kernel length on each side, in zero crossings of
 * the sinc. 16 keeps the stopband below about -70 dB, which is far past what
 * the acoustic model can hear.
 */
export function resampleSinc(
	x: Float32Array,
	from: number,
	to: number,
	zeroCrossings = 16,
): Float32Array {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to <= 0) {
		throw new Error(`resampleSinc: rates must be positive integers, got ${from} and ${to}`);
	}
	if (from === to) return x;
	const g = gcd(from, to);
	const up = to / g;
	const down = from / g;
	// Cutoff relative to the input Nyquist: below 1 when downsampling.
	const cutoff = Math.min(1, to / from);
	const half = Math.ceil(zeroCrossings / cutoff);
	const taps = 2 * half;

	// table[p][j] weighs input sample `base - half + 1 + j` for phase p.
	const table = new Float32Array(up * taps);
	for (let p = 0; p < up; p++) {
		const frac = p / up;
		let sum = 0;
		for (let j = 0; j < taps; j++) {
			const d = frac - (j - half + 1);
			const h = cutoff * sinc(cutoff * d) * blackman(d, half);
			table[p * taps + j] = h;
			sum += h;
		}
		// Unit gain at DC for every phase, so a constant stays constant.
		for (let j = 0; j < taps; j++) table[p * taps + j] = (table[p * taps + j] as number) / sum;
	}

	const n = x.length;
	const outLen = Math.ceil((n * up) / down);
	const out = new Float32Array(outLen);
	for (let i = 0; i < outLen; i++) {
		const num = i * down;
		const base = Math.floor(num / up);
		const p = num - base * up;
		const first = base - half + 1;
		const row = p * taps;
		let acc = 0;
		if (first >= 0 && first + taps <= n) {
			for (let j = 0; j < taps; j++) acc += (x[first + j] as number) * (table[row + j] as number);
		} else {
			// Near the edges, samples outside the signal count as silence.
			for (let j = 0; j < taps; j++) {
				const k = first + j;
				if (k >= 0 && k < n) acc += (x[k] as number) * (table[row + j] as number);
			}
		}
		out[i] = acc;
	}
	return out;
}
