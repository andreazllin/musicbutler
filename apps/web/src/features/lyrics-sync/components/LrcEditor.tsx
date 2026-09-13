import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import {
	placeholder as cmPlaceholder,
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import {
	type FunctionComponent,
	type RefObject,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";
import { lrcLanguage } from "../editor/lrc-language";
import { lrcLinter } from "../editor/lrc-lint";
import { isProgrammatic, programmatic } from "../editor/programmatic";
import { lrcEditorTheme } from "../editor/theme";
import classes from "./LrcEditor.module.css";

export type LrcEditorHandle = {
	/**
	 * Replace the whole document in ONE transaction, so that editor undo reverses it in
	 * one step (docs/PLAN.md §10 M8). Used by "Apply offset" and by a finished sync.
	 */
	replaceText: (text: string) => void;
	focus: () => void;
};

type Props = {
	/** Document text. The editor reflects it; edits go through `onChange`. */
	value: string;
	onChange: (text: string) => void;
	disabled?: boolean;
	/** Loaded audio duration in seconds, for the "past the end" lint warning. */
	durationSeconds?: number;
	placeholder?: string;
	handleRef?: RefObject<LrcEditorHandle | null>;
	className?: string;
};

/**
 * CodeMirror 6 with the custom LRC mode and linter (docs/PLAN.md §7.4). Line
 * numbers, history, search and soft wrap are on. Bracket matching is off on
 * purpose, because brackets are syntax in this format.
 */
export const LrcEditor: FunctionComponent<Props> = ({
	value,
	onChange,
	disabled = false,
	durationSeconds,
	placeholder,
	handleRef,
	className,
}) => {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const durationRef = useRef(durationSeconds);
	durationRef.current = durationSeconds;
	const editableRef = useRef(new Compartment());
	const placeholderRef = useRef(new Compartment());

	// The editor is created once; later prop changes are dispatched by the effects below.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const state = EditorState.create({
			doc: value,
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightActiveLine(),
				history(),
				drawSelection(),
				search({ top: true }),
				highlightSelectionMatches(),
				EditorView.lineWrapping,
				lrcLanguage(),
				lrcEditorTheme,
				lrcLinter(() => durationRef.current),
				editableRef.current.of([
					EditorView.editable.of(!disabled),
					EditorState.readOnly.of(disabled),
				]),
				placeholderRef.current.of(placeholder ? cmPlaceholder(placeholder) : []),
				keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...lintKeymap]),
				EditorView.updateListener.of((update) => {
					if (update.docChanged && !isProgrammatic(update)) {
						onChangeRef.current(update.state.doc.toString());
					}
				}),
			],
		});
		const view = new EditorView({ state, parent: host });
		viewRef.current = view;
		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, []);

	// External value changes (song switch, reload, sync result) replace the document.
	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const current = view.state.doc.toString();
		if (current === value) return;
		view.dispatch({
			changes: { from: 0, to: current.length, insert: value },
			annotations: [
				programmatic.of(true),
				// A fresh document must not be undoable back into the previous song's text.
				Transaction.addToHistory.of(false),
			],
		});
	}, [value]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		view.dispatch({
			effects: editableRef.current.reconfigure([
				EditorView.editable.of(!disabled),
				EditorState.readOnly.of(disabled),
			]),
		});
		view.dom.classList.toggle("cm-readonly", disabled);
	}, [disabled]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		view.dispatch({
			effects: placeholderRef.current.reconfigure(placeholder ? cmPlaceholder(placeholder) : []),
		});
	}, [placeholder]);

	useImperativeHandle(
		handleRef,
		() => ({
			replaceText: (text) => {
				const view = viewRef.current;
				if (!view) return;
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: text },
					selection: { anchor: Math.min(view.state.selection.main.anchor, text.length) },
					userEvent: "input.replace",
					// Stays in the undo history, but the callers update the buffer
					// themselves, so it must not come back as an edit.
					annotations: programmatic.of(true),
				});
			},
			focus: () => viewRef.current?.focus(),
		}),
		[],
	);

	return (
		<div
			ref={hostRef}
			className={[classes.host, disabled && classes.disabled, className].filter(Boolean).join(" ")}
		/>
	);
};
