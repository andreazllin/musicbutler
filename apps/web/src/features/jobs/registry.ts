import type { JobKind } from "@musicbutler/shared";
import { IconMusic } from "@tabler/icons-react";
import type { ComponentType } from "react";
import { SONG_QUERY_KEY } from "@/features/lyrics-sync/constants";
import { encodeBase64Url } from "@/lib/base64url";

/**
 * What the queue screen needs to draw one kind of job (docs/PLAN.md §7.1).
 *
 * The queue itself is generic: it holds an id, a state, a percentage and the
 * words the owning tool gave it. Everything that is specific to a kind lives
 * here, so a second kind of job is one entry in this table and a new value in
 * `JOB_KINDS`, and the screen does not change.
 */
export type JobKindDefinition = {
	/** Name of the work, for a tooltip and for a screen reader. */
	label: string;
	icon: ComponentType<{ size?: number | string }>;
	/** Turns a stage id of this kind into words. */
	stageLabel: (stage: string) => string;
	/** Where Open goes, or null when one job of this kind has no screen. */
	linkTo: (ref: string) => { to: string; search: Record<string, string> } | null;
};

/** Words for the stages of a lyrics sync, in the order they run. */
const LYRICS_SYNC_STAGES: Record<string, string> = {
	queued: "In the queue",
	decode: "Reads the audio",
	separate: "Isolates the vocals",
	transcribe: "Listens to the audio",
	align: "Aligns the lyrics",
	write: "Writes the .lrc file",
};

export const JOB_KIND_UI: Record<JobKind, JobKindDefinition> = {
	"lyrics-sync": {
		label: "Lyrics Sync",
		icon: IconMusic,
		stageLabel: (stage) => LYRICS_SYNC_STAGES[stage] ?? "Works",
		linkTo: (ref) => ({
			to: "/tools/lyrics-sync",
			search: { [SONG_QUERY_KEY]: encodeBase64Url(ref) },
		}),
	},
};

/** Falls back to something drawable when a job arrives from a newer server. */
export function jobKindUi(kind: JobKind): JobKindDefinition {
	return (
		JOB_KIND_UI[kind] ?? {
			label: kind,
			icon: IconMusic,
			stageLabel: (stage: string) => stage,
			linkTo: () => null,
		}
	);
}
