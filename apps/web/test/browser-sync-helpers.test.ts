import { describe, expect, test } from "bun:test";
import type { BrowserModel } from "@musicbutler/shared";
import { localState } from "../src/features/browser-sync/helpers/local-state";
import { stagePct } from "../src/features/browser-sync/helpers/progress";
import { isBrowserJobId, toJobSummary } from "../src/features/browser-sync/helpers/to-job-summary";
import type { BrowserJob } from "../src/stores/browser-sync-store";

const model: BrowserModel = {
	id: "en-US",
	files: [{ name: "config.json", bytes: 10 }],
	bytes: 10,
	available: true,
	version: "10-1",
};

describe("localState", () => {
	test("missing when the browser holds no copy", () => {
		expect(localState(model, undefined)).toBe("missing");
	});

	test("ready when the versions match, outdated when they differ", () => {
		const record = { id: "en-US" as const, version: "10-1", bytes: 10, savedAt: 0 };
		expect(localState(model, record)).toBe("ready");
		expect(localState(model, { ...record, version: "10-2" })).toBe("outdated");
	});
});

describe("stagePct", () => {
	test("each stage starts where the one before it ends", () => {
		for (const isolate of [true, false]) {
			const order = isolate
				? (["decode", "load", "separate", "transcribe", "align", "write"] as const)
				: (["decode", "load", "transcribe", "align", "write"] as const);
			let previous = 0;
			for (const stage of order) {
				expect(stagePct(isolate, stage, 0, 1)).toBe(previous);
				previous = stagePct(isolate, stage, 1, 1);
			}
			expect(previous).toBe(100);
		}
	});

	test("moves in proportion inside a stage and never past its end", () => {
		expect(stagePct(true, "separate", 1, 2)).toBe(40);
		expect(stagePct(true, "separate", 5, 2)).toBe(72);
	});

	test("a stage with no span reads as zero", () => {
		expect(stagePct(false, "separate", 1, 1)).toBe(0);
		expect(stagePct(true, "download", 1, 1)).toBe(0);
	});
});

describe("toJobSummary", () => {
	const job: BrowserJob = {
		id: "browser-3",
		audioPath: "Artist/Album/01 Song.mp3",
		lang: "it-IT",
		status: "running",
		stage: "transcribe",
		pct: 50,
		createdAt: 1,
		startedAt: 2,
		finishedAt: null,
	};

	test("draws like a server job and says where it runs", () => {
		const summary = toJobSummary(job);
		expect(summary.kind).toBe("lyrics-sync");
		expect(summary.ref).toBe(job.audioPath);
		expect(summary.title).toBe("01 Song.mp3");
		expect(summary.subtitle).toBe("Artist/Album");
		expect(summary.badges).toEqual(["Italiano", "This browser"]);
	});

	test("a song at the library root has no subtitle", () => {
		expect(toJobSummary({ ...job, audioPath: "Song.mp3" }).subtitle).toBeUndefined();
	});

	test("browser ids never look like server ids", () => {
		expect(isBrowserJobId(job.id)).toBe(true);
		expect(isBrowserJobId("3b241101-e2bb-4255-8caf-4136c566a962")).toBe(false);
	});
});
