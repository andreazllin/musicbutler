import { createParser, useQueryState } from "nuqs";
import { decodeBase64Url, encodeBase64Url } from "@/lib/base64url";
import { SONG_QUERY_KEY } from "../constants";

/**
 * The path is base64url-encoded in the URL so the query string does not show
 * the folder layout of someone's library. It is obfuscation for the address
 * bar and for screen sharing, not a security boundary: anyone can decode it,
 * and the server still checks every path it is given.
 */
const songPathParser = createParser({
	parse: decodeBase64Url,
	serialize: encodeBase64Url,
});

/**
 * The selected audio path lives in the URL (docs/PLAN.md §7.2, §13.6), so a user
 * can link to a song and reload into it.
 */
export function useSelectedSong() {
	return useQueryState(SONG_QUERY_KEY, songPathParser.withOptions({ history: "push" }));
}
