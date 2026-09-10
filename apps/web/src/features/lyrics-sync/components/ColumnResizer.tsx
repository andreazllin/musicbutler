import type { FunctionComponent, KeyboardEvent, PointerEvent } from "react";
import { useRef } from "react";
import classes from "./ColumnResizer.module.css";

type Props = {
	width: number;
	min: number;
	max: number;
	onChange: (width: number) => void;
	label: string;
};

/** A vertical drag handle between the two columns (docs/PLAN.md §7.3). Arrow keys resize too. */
export const ColumnResizer: FunctionComponent<Props> = ({ width, min, max, onChange, label }) => {
	const startRef = useRef<{ x: number; width: number } | null>(null);
	const clamp = (w: number) => Math.min(max, Math.max(min, w));

	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		startRef.current = { x: e.clientX, width };
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		const start = startRef.current;
		if (!start) return;
		onChange(clamp(start.width + (e.clientX - start.x)));
	};
	const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
		startRef.current = null;
		e.currentTarget.releasePointerCapture(e.pointerId);
	};
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === "ArrowLeft") onChange(clamp(width - 16));
		else if (e.key === "ArrowRight") onChange(clamp(width + 16));
		else if (e.key === "Home") onChange(min);
		else if (e.key === "End") onChange(max);
		else return;
		e.preventDefault();
	};

	return (
		// biome-ignore lint/a11y/useSemanticElements: a resizable separator has no native element
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={label}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={width}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onKeyDown={onKeyDown}
			className={classes.resizer}
		/>
	);
};
