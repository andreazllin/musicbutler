import { isAudioFile } from "@musicbutler/shared";
import { createParser, useQueryState } from "nuqs";
import { decodeBase64Url, encodeBase64Url } from "@/lib/base64url";
import { SONG_QUERY_KEY } from "../constants";

/**
 * The path is base64url-encoded in the URL so the query string does not show
 * the folder layout of someone's library. It is obfuscation for the address
 * bar and for screen sharing, not a security boundary: anyone can decode it,
 * and the server still checks every path it is given.
 *
 * Anything that does not name a supported audio file parses to null. That is
 * the single guard for the whole screen: a directory, a `.lrc`, a stale link
 * or a hand-edited parameter never reaches `lrc.get`, which would answer
 * "audioPath must point to an audio file" and surface as an error panel.
 */
const songPathParser = createParser({
	parse: (query): string | null => {
		const path = decodeBase64Url(query);
		return path !== null && isAudioFile(path) ? path : null;
	},
	serialize: encodeBase64Url,
});

/**
 * The selected audio path lives in the URL (docs/PLAN.md §7.2, §13.6), so a user
 * can link to a song and reload into it.
 */
export function useSelectedSong() {
	return useQueryState(SONG_QUERY_KEY, songPathParser.withOptions({ history: "push" }));
}
