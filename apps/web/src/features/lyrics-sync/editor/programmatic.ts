import { Annotation, type Transaction } from "@codemirror/state";

/**
 * Marks a transaction the editor component dispatched itself, as opposed to
 * something the user typed.
 *
 * Without it a programmatic document replacement is reported as an edit.
 * Switching songs replaces the document with the pending (empty) content of the
 * next song, which was then written into the unsaved buffer: the new song
 * opened blank and marked "Unsaved changes" even though nobody had typed.
 */
export const programmatic = Annotation.define<boolean>();

/** True when every change in this update came from the component, not the user. */
export function isProgrammatic(update: { transactions: readonly Transaction[] }): boolean {
	return update.transactions.some((tr) => tr.annotation(programmatic));
}
