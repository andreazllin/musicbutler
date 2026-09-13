import { describe, expect, test } from "bun:test";
import type { JobSummary } from "@musicbutler/shared";
import {
	activeCount,
	activeJobFor,
	elapsedLabel,
	sortForDisplay,
} from "../src/features/jobs/helpers/queue";

function job(over: Partial<JobSummary> & Pick<JobSummary, "id" | "status">): JobSummary {
	return {
		audioPath: "Artist/Album/Song.mp3",
		lang: "en-US",
		stage: "queued",
		pct: 0,
		createdAt: 0,
		startedAt: null,
		finishedAt: null,
		...over,
	};
}

describe("jobs/helpers/queue", () => {
	test("the running job leads, then the queue in arrival order, then the newest finished", () => {
		const ordered = sortForDisplay([
			job({ id: "old-done", status: "done", finishedAt: 100 }),
			job({ id: "second", status: "queued", createdAt: 20 }),
			job({ id: "new-done", status: "error", finishedAt: 900 }),
			job({ id: "first", status: "queued", createdAt: 10 }),
			job({ id: "running", status: "running", createdAt: 5 }),
		]);
		expect(ordered.map((j) => j.id)).toEqual([
			"running",
			"first",
			"second",
			"new-done",
			"old-done",
		]);
	});

	test("sorting does not change the array it is given", () => {
		const input = [job({ id: "b", status: "done" }), job({ id: "a", status: "running" })];
		sortForDisplay(input);
		expect(input.map((j) => j.id)).toEqual(["b", "a"]);
	});

	test("only queued and running jobs count as active", () => {
		expect(
			activeCount([
				job({ id: "1", status: "queued" }),
				job({ id: "2", status: "running" }),
				job({ id: "3", status: "done" }),
				job({ id: "4", status: "error" }),
				job({ id: "5", status: "cancelled" }),
			]),
		).toBe(2);
	});

	test("activeJobFor matches the path and ignores finished jobs", () => {
		const jobs = [
			job({ id: "done", status: "done", audioPath: "a.mp3" }),
			job({ id: "live", status: "running", audioPath: "a.mp3" }),
			job({ id: "other", status: "running", audioPath: "b.mp3" }),
		];
		expect(activeJobFor(jobs, "a.mp3")?.id).toBe("live");
		expect(activeJobFor(jobs, "b.mp3")?.id).toBe("other");
		expect(activeJobFor(jobs, "c.mp3")).toBeUndefined();
		expect(activeJobFor(jobs, null)).toBeUndefined();
	});

	test("a queued job has no elapsed time, because it has not started", () => {
		expect(elapsedLabel(job({ id: "q", status: "queued" }), 10_000)).toBeNull();
	});

	test("elapsed counts to now while running and freezes when finished", () => {
		expect(elapsedLabel(job({ id: "r", status: "running", startedAt: 1000 }), 46_000)).toBe("45s");
		expect(
			elapsedLabel(job({ id: "d", status: "done", startedAt: 1000, finishedAt: 5000 }), 999_999),
		).toBe("4s");
	});

	test("a minute or more reads as minutes and padded seconds", () => {
		expect(elapsedLabel(job({ id: "r", status: "running", startedAt: 0 }), 64_000)).toBe("1m 04s");
		expect(elapsedLabel(job({ id: "r", status: "running", startedAt: 0 }), 600_000)).toBe(
			"10m 00s",
		);
	});
});
