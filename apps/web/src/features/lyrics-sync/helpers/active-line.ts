/**
 * Index of the last timestamp that is <= `time`, or -1 when none has started yet.
 * `times` must be sorted ascending. Binary search (docs/PLAN.md §7.6).
 */
export function findActiveLine(times: ArrayLike<number>, time: number): number {
	let lo = 0;
	let hi = times.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (times[mid] <= time) {
			found = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found;
}
