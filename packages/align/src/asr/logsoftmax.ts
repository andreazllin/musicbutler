/**
 * Row-wise log-softmax in float32 (docs/lyrics-sync-functionality-implementation-plan.md §7.4).
 */

/** Returns a new array; `data` must hold `rows * cols` values, row-major. */
export function logSoftmaxRows(data: Float32Array, rows: number, cols: number): Float32Array {
	if (data.length < rows * cols) throw new Error("logSoftmaxRows: data too short");
	const out = new Float32Array(rows * cols);
	for (let r = 0; r < rows; r++) {
		const off = r * cols;
		let max = -Infinity;
		for (let c = 0; c < cols; c++) {
			const v = data[off + c] as number;
			if (v > max) max = v;
		}
		let sum = 0;
		for (let c = 0; c < cols; c++) sum += Math.exp((data[off + c] as number) - max);
		const logSum = max + Math.log(sum);
		for (let c = 0; c < cols; c++) out[off + c] = (data[off + c] as number) - logSum;
	}
	return out;
}
