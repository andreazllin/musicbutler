// Mantine ships its styles as plain CSS that needs this preset: it turns
// `light-dark()`, `rem()` and the `@mixin` helpers into what browsers read.
module.exports = {
	plugins: {
		"postcss-preset-mantine": {},
		"postcss-simple-vars": {
			variables: {
				"mantine-breakpoint-xs": "36em",
				"mantine-breakpoint-sm": "48em",
				"mantine-breakpoint-md": "62em",
				"mantine-breakpoint-lg": "75em",
				"mantine-breakpoint-xl": "88em",
			},
		},
	},
};
