/**
 * Guesses the artist, album and title of a song from its path.
 *
 * The server reads no audio tags, so the path is all there is. The usual
 * layout is `<artist>/<album>/<track>`, and the two folders above the file are
 * the best guess whatever the depth above them. The guess is a starting point:
 * the import screen shows it in fields the user can correct before searching.
 */

/**
 * Leading track numbers: "01 ", "01. ", "01 - ", "02_", and the "1-05" of a
 * multi-disc set. A separator is required, so a song called "01" keeps its name.
 */
const TRACK_NUMBER = /^\s*(?:\d{1,2}\s*[-.]\s*)?\d{1,3}\s*(?:[-._)]\s*|\s+)/;

export type SongGuess = { artist: string; album: string; title: string };

/** Drops the extension and any leading track number. */
export function titleFromFileName(name: string): string {
	const dot = name.lastIndexOf(".");
	const base = dot > 0 ? name.slice(0, dot) : name;
	const withoutNumber = base.replace(TRACK_NUMBER, "");
	// A track called "01" is all number: keep the original rather than nothing.
	const cleaned = withoutNumber.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
	return cleaned !== "" ? cleaned : base.trim();
}

/**
 * The folder right above the file is the album and the one above that is the
 * artist. A file with one folder above it has an artist and no album, and a
 * file at the root of the library has neither.
 */
export function guessFromPath(audioPath: string): SongGuess {
	const parts = audioPath.split("/").filter((part) => part !== "");
	const fileName = parts.pop() ?? "";
	const album = parts.length >= 2 ? (parts.at(-1) ?? "") : "";
	const artist = parts.length >= 2 ? (parts.at(-2) ?? "") : (parts.at(-1) ?? "");
	return {
		artist: artist.trim(),
		album: album.trim(),
		title: titleFromFileName(fileName),
	};
}
