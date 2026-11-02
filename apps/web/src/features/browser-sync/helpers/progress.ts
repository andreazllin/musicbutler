import type { BrowserSyncStage } from "../constants";

type Span = [from: number, to: number];

/**
 * Percentage span of each stage of a browser sync, so the bar moves in
 * proportion to the time each stage takes. Separation is most of a run when
 * it is on. The download has a bar of its own, so it has no span here.
 */
const SPANS: Record<"isolate" | "direct", Partial<Record<BrowserSyncStage, Span>>> = {
	isolate: {
		decode: [0, 3],
		load: [3, 8],
		separate: [8, 72],
		transcribe: [72, 94],
		align: [94, 97],
		write: [97, 100],
	},
	direct: {
		decode: [0, 5],
		load: [5, 12],
		transcribe: [12, 90],
		align: [90, 97],
		write: [97, 100],
	},
};

/** The overall percentage when `done` of `total` parts of `stage` are finished. */
export function stagePct(
	isolateVocals: boolean,
	stage: BrowserSyncStage,
	done: number,
	total: number,
): number {
	const span = SPANS[isolateVocals ? "isolate" : "direct"][stage];
	if (!span) return 0;
	const [from, to] = span;
	const frac = total > 0 ? Math.min(1, done / total) : 1;
	return Math.round((from + (to - from) * frac) * 10) / 10;
}
