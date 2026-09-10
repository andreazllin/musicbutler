import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { DEFAULT_TOOL_PATH, TOOLS } from "@/features/registry";
import { AppShell } from "@/layouts/app-shell";
import { NotFoundPage } from "@/pages/not-found-page";
import { RouteProviders } from "./providers";

const rootRoute = createRootRoute({
	component: () => (
		<RouteProviders>
			<AppShell />
		</RouteProviders>
	),
	notFoundComponent: NotFoundPage,
});

/** `/` redirects to the first tool (docs/PLAN.md §7.1). */
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	beforeLoad: () => {
		throw redirect({ to: DEFAULT_TOOL_PATH, replace: true });
	},
	component: Outlet,
});

// One route per registered tool. The registry is the single source of truth.
const toolRoutes = TOOLS.map((tool) =>
	createRoute({
		getParentRoute: () => rootRoute,
		path: tool.path,
		component: tool.element,
	}),
);

const routeTree = rootRoute.addChildren([indexRoute, ...toolRoutes]);

export const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	scrollRestoration: true,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
