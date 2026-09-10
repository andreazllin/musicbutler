import { type Diagnostic as CmDiagnostic, linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { validate } from "@musicbutler/lrc";

/**
 * The LRC linter (docs/PLAN.md §7.4). Every diagnostic comes from `packages/lrc`;
 * this file is a thin adapter to CodeMirror's `linter()` helper.
 *
 * @param getDuration returns the loaded audio duration in seconds, or undefined
 * while it is unknown. The "timestamp past the audio duration" warning needs it.
 */
export function lrcLinter(getDuration: () => number | undefined): Extension {
	return linter(
		(view) => {
			const text = view.state.doc.toString();
			const max = text.length;
			return validate(text, { durationSeconds: getDuration() }).map(
				(d): CmDiagnostic => ({
					from: Math.min(d.from, max),
					to: Math.min(Math.max(d.to, d.from), max),
					severity: d.severity,
					message: d.message,
					source: "lrc",
				}),
			);
		},
		{ delay: 300 },
	);
}
