/**
 * `lyrics.*`: import words from an outside source (docs/PLAN.md §6.2).
 *
 * `search` asks every provider and answers with the rows it got plus the
 * providers that failed, so one blocked source does not empty the screen.
 * `fetch` returns the words of one row. Nothing here writes to the library:
 * the text lands in the editor and the user still has to save it.
 */
import type { LyricsCandidate, LyricsFetchResult } from "@musicbutler/shared";
import { LYRICS_PROVIDERS } from "@musicbutler/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fetchLyrics, LyricsError, searchLyrics } from "../lyrics/index.ts";
import { publicProcedure, router } from "../trpc.ts";

export const providerSchema = z.enum(LYRICS_PROVIDERS);

export const lyricsSearchInput = z.object({
	artist: z.string().trim().max(200),
	title: z.string().trim().min(1, "Give a song title to search for").max(200),
	album: z.string().trim().max(200).optional(),
	/** From the player, so LRCLIB can match on the exact length. */
	durationSec: z.number().positive().max(86_400).optional(),
});

export const lyricsSearchOutput = z.object({
	candidates: z.array(z.custom<LyricsCandidate>()),
	failures: z.array(z.object({ provider: providerSchema, message: z.string() })),
});

export const lyricsFetchInput = z.object({
	provider: providerSchema,
	id: z.string().min(1),
});

export const lyricsRouter = router({
	search: publicProcedure
		.input(lyricsSearchInput)
		.output(lyricsSearchOutput)
		.query(({ input, signal }) =>
			searchLyrics({
				artist: input.artist,
				title: input.title,
				album: input.album,
				durationSec: input.durationSec,
				signal,
			}),
		),

	fetch: publicProcedure
		.input(lyricsFetchInput)
		.output(z.custom<LyricsFetchResult>())
		.query(async ({ input, signal }) => {
			try {
				return await fetchLyrics(input.provider, input.id, signal);
			} catch (error) {
				// A provider failure is the source's fault, not the caller's, and the
				// message is written for the user to read.
				throw new TRPCError({
					code: "BAD_GATEWAY",
					message:
						error instanceof LyricsError
							? error.message
							: "The app could not read the lyrics from that source.",
					cause: error,
				});
			}
		}),
});
