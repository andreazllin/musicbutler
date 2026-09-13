import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { isProgrammatic, programmatic } from "../src/features/lyrics-sync/editor/programmatic";

const state = EditorState.create({ doc: "[00:01.00]alpha\n" });
const change = { from: 0, to: state.doc.length, insert: "[00:02.00]bravo\n" };

describe("the programmatic annotation", () => {
	test("a plain edit is reported as the user's", () => {
		expect(isProgrammatic({ transactions: [state.update({ changes: change })] })).toBe(false);
	});

	test("an annotated edit is not", () => {
		const tr = state.update({ changes: change, annotations: programmatic.of(true) });
		expect(isProgrammatic({ transactions: [tr] })).toBe(true);
	});

	test("a batch holding one programmatic transaction counts as programmatic", () => {
		const user = state.update({ changes: change });
		const mine = state.update({ changes: change, annotations: programmatic.of(true) });
		expect(isProgrammatic({ transactions: [user, mine] })).toBe(true);
	});

	test("an update with no transactions is the user's", () => {
		expect(isProgrammatic({ transactions: [] })).toBe(false);
	});

	test("the annotation survives the dispatch shape the editor uses", () => {
		// Mirrors the song-switch replacement: annotated, and kept out of undo.
		const tr = state.update({
			changes: change,
			annotations: [programmatic.of(true)],
		});
		expect(tr.docChanged).toBe(true);
		expect(isProgrammatic({ transactions: [tr] })).toBe(true);
	});
});
