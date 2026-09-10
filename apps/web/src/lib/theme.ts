import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * The Mantine theme (docs/PLAN.md §4.1). Only the brand scale and the fonts are
 * set; every other value stays at the Mantine default, so the app follows the
 * library instead of carrying a second design system.
 */

/** The purple the app shipped with. Index 6 is `#7f56d9`, the `theme-color` in index.html. */
const brand: MantineColorsTuple = [
	"#f9f5ff",
	"#f4ebff",
	"#e9d7fe",
	"#d6bbfb",
	"#b692f6",
	"#9e77ed",
	"#7f56d9",
	"#6941c6",
	"#53389e",
	"#42307d",
];

export const theme = createTheme({
	primaryColor: "brand",
	primaryShade: { light: 6, dark: 5 },
	colors: { brand },
	fontFamily: 'Inter, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
	fontFamilyMonospace:
		'ui-monospace, "Roboto Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
	headings: { fontFamily: "Inter, -apple-system, sans-serif" },
	defaultRadius: "md",
	cursorType: "pointer",
});
