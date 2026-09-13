/**
 * Fuzzy matching for the library filter.
 *
 * The query does not have to be contiguous or complete: every character has to
 * appear in order, so "lvl5dp" finds "Level5/Deep Song.mp3". Whitespace splits
 * the query into terms that are matched independently and must all hit, so
 * "deep level5" works as well as "level5 deep" — a search box is not the place
 * to make someone remember the order things are nested in.
 */

/** Characters that start a new word, so a match on the next one counts for more. */
const BOUNDARY = new Set([" ", "-", "_", ".", "/", "(", ")", "[", "]", ",", "'", "&"]);

const CONSECUTIVE_BONUS = 4;
const BOUNDARY_BONUS = 6;
/** Caps how much a short target can win by, so one good match cannot be buried. */
const MAX_LENGTH_PENALTY = 20;

function scoreTerm(term: string, target: string): number | null {
	let score = 0;
	let from = 0;
	let previous = -2;
	let run = 0;

	for (const char of term) {
		const at = target.indexOf(char, from);
		// Leftmost matching always finds a subsequence when one exists, so this
		// only ever rejects a genuine miss.
		if (at === -1) return null;

		let bonus = 1;
		if (at === previous + 1) {
			run += 1;
			bonus += CONSECUTIVE_BONUS + run;
		} else {
			run = 0;
		}
		if (at === 0 || BOUNDARY.has(target[at - 1] ?? "")) bonus += BOUNDARY_BONUS;

		score += bonus;
		previous = at;
		from = at + 1;
	}

	// A tighter target is the better answer for the same characters.
	return score - Math.min(target.length - term.length, MAX_LENGTH_PENALTY) * 0.1;
}

/**
 * How well `query` matches `target`, or null when it does not. Higher is better;
 * the number is only meaningful against other scores for the same query.
 * An empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, target: string): number | null {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return 0;
	const lower = target.toLowerCase();

	let total = 0;
	for (const term of terms) {
		const score = scoreTerm(term, lower);
		if (score === null) return null;
		total += score;
	}
	return total;
}

/** True when `query` matches any of `targets`. An empty query matches everything. */
export function fuzzyMatches(query: string, ...targets: string[]): boolean {
	if (query.trim() === "") return true;
	return targets.some((target) => fuzzyScore(query, target) !== null);
}
