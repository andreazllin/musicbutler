import { EditorView } from "@codemirror/view";

/**
 * Editor theme built from Mantine's CSS variables (docs/PLAN.md §7.4). No colors
 * are picked here; every value is a token, so the editor follows the
 * `data-mantine-color-scheme` attribute with no JavaScript.
 */
export const lrcEditorTheme = EditorView.theme({
	"&": {
		height: "100%",
		fontSize: "13px",
		backgroundColor: "var(--mantine-color-body)",
		color: "var(--mantine-color-text)",
	},
	".cm-scroller": {
		fontFamily: "var(--mantine-font-family-monospace)",
		lineHeight: "1.6",
	},
	".cm-content": {
		caretColor: "var(--mantine-primary-color-filled)",
		padding: "8px 0",
	},
	"&.cm-focused": { outline: "none" },
	".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--mantine-primary-color-filled)" },
	// CodeMirror paints the selection in `.cm-selectionLayer`, at z-index -2, so
	// it sits behind the line elements. Both of these must therefore let it
	// through: the active-line background is a translucent mix rather than a
	// solid color, and the selection itself is strong enough to read against it.
	"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
		{ backgroundColor: "color-mix(in srgb, var(--mantine-primary-color-filled) 32%, transparent)" },
	".cm-activeLine": {
		backgroundColor: "color-mix(in srgb, var(--mantine-color-text) 6%, transparent)",
	},
	".cm-gutters": {
		backgroundColor: "var(--mantine-color-default)",
		color: "var(--mantine-color-dimmed)",
		borderRight: "1px solid var(--mantine-color-default-border)",
	},
	".cm-activeLineGutter": {
		backgroundColor: "color-mix(in srgb, var(--mantine-color-text) 6%, transparent)",
		color: "var(--mantine-color-text)",
	},
	".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px", minWidth: "40px" },
	".cm-selectionMatch": {
		backgroundColor: "color-mix(in srgb, var(--mantine-color-yellow-filled) 28%, transparent)",
	},
	".cm-searchMatch": {
		backgroundColor: "color-mix(in srgb, var(--mantine-color-yellow-filled) 28%, transparent)",
		outline: "1px solid var(--mantine-color-default-border)",
	},
	".cm-searchMatch.cm-searchMatch-selected": {
		backgroundColor: "color-mix(in srgb, var(--mantine-primary-color-filled) 45%, transparent)",
	},
	".cm-panels": {
		backgroundColor: "var(--mantine-color-default)",
		color: "var(--mantine-color-text)",
		borderColor: "var(--mantine-color-default-border)",
	},
	".cm-panels input, .cm-panels button": {
		backgroundColor: "var(--mantine-color-body)",
		color: "var(--mantine-color-text)",
		border: "1px solid var(--mantine-color-default-border)",
		borderRadius: "var(--mantine-radius-sm)",
	},
	".cm-tooltip": {
		backgroundColor: "var(--mantine-color-default)",
		color: "var(--mantine-color-text)",
		border: "1px solid var(--mantine-color-default-border)",
		borderRadius: "var(--mantine-radius-md)",
	},
	".cm-tooltip-lint": { padding: "4px 0" },
	".cm-diagnostic": { padding: "2px 8px", borderLeftWidth: "3px" },
	".cm-diagnostic-error": { borderLeftColor: "var(--mantine-color-red-filled)" },
	".cm-diagnostic-warning": { borderLeftColor: "var(--mantine-color-yellow-filled)" },
	".cm-diagnostic-info": { borderLeftColor: "var(--mantine-primary-color-filled)" },
	".cm-lintRange-error": {
		backgroundImage: "none",
		textDecoration: "underline wavy var(--mantine-color-red-filled)",
	},
	".cm-lintRange-warning": {
		backgroundImage: "none",
		textDecoration: "underline wavy var(--mantine-color-yellow-filled)",
	},
	".cm-lintRange-info": {
		backgroundImage: "none",
		textDecoration: "underline dotted var(--mantine-primary-color-filled)",
	},
	".cm-lint-marker-error": { content: "none" },

	// Token classes from ./lrc-language.ts
	".lrc-timestamp": { color: "var(--mantine-primary-color-filled)", fontWeight: "600" },
	".lrc-word-time": { color: "var(--mantine-color-blue-text)" },
	".lrc-meta-key": { color: "var(--mantine-color-dimmed)", fontWeight: "600" },
	".lrc-meta-value": { color: "var(--mantine-color-text)", fontStyle: "italic" },
	".lrc-text": { color: "var(--mantine-color-text)" },
	".lrc-invalid": { color: "var(--mantine-color-error)", textDecoration: "underline wavy" },

	"&.cm-editor.cm-readonly .cm-content": { opacity: "0.6" },
});
