/** `mm:ss.xx` display of a time in seconds, floored to centiseconds and clamped at 0. */
export function formatClock(seconds: number): string {
	const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
	const total = Math.floor(s * 100);
	const mm = Math.floor(total / 6000);
	const ss = Math.floor((total % 6000) / 100);
	const xx = total % 100;
	return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(xx).padStart(2, "0")}`;
}

/** Human readable byte count. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
