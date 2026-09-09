/**
 * Synthetic LRC fixtures (docs/PLAN.md §5.7): placeholder text only, never
 * real song lyrics. Kept as strings so the tests need no filesystem access.
 */

export const LINE_LEVEL = [
	"[ti:Placeholder Title]",
	"[ar:Placeholder Artist]",
	"[al:Placeholder Album]",
	"",
	"[00:01.00]line one",
	"[00:05.50]line two",
	"[01:02.75]line three",
	"",
].join("\n");

export const WORD_LEVEL = [
	"[00:01.00] <00:01.00>la <00:01.50>la <00:02.00>la",
	"[00:05.00] <00:05.00>line <00:05.40>two",
	"",
].join("\n");

export const REPEATED = ["[00:10.00][00:50.00]la la la", "[00:15.00]line one", ""].join("\n");

export const META_ONLY = [
	"[ti:Placeholder]",
	"[ar:Nobody]",
	"[offset:500]",
	"[xcustom:kept]",
	"",
].join("\n");

export const MM_OVER_59 = ["[75:00.00]line one", "[125:30.25]line two", ""].join("\n");

export const CRLF = "[ti:Placeholder]\r\n\r\n[00:01.00]line one\r\n[00:02.00]line two\r\n";

export const NO_TRAILING_NEWLINE = "[00:01.00]line one\n[00:02.00]line two";

export const EMPTY = "";

export const GARBAGE = [
	"[ti:Placeholder]",
	"this line has no tag",
	"[Chorus]",
	"[1:2]bad tag",
	"[99:99.99]worse tag",
	"[00:03.00]line one",
	"   ",
	"[00:04.00]line two",
	"",
].join("\n");

export const ALL: Record<string, string> = {
	LINE_LEVEL,
	WORD_LEVEL,
	REPEATED,
	META_ONLY,
	MM_OVER_59,
	CRLF,
	NO_TRAILING_NEWLINE,
	EMPTY,
	GARBAGE,
};
