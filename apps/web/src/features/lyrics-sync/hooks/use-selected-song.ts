import { parseAsString, useQueryState } from "nuqs";
import { SONG_QUERY_KEY } from "../constants";

/**
 * The selected audio path lives in the URL (docs/PLAN.md §7.2, §13.6), so a user
 * can link to a song and reload into it.
 */
export function useSelectedSong() {
	return useQueryState(SONG_QUERY_KEY, parseAsString.withOptions({ history: "push" }));
}
