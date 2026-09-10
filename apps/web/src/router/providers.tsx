import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/tanstack-router";
import type { FunctionComponent, PropsWithChildren } from "react";
import { queryClient } from "@/lib/query-client";
import { theme } from "@/lib/theme";
import { TRPCProvider, trpcClient } from "@/lib/trpc";

/**
 * Providers that need the TanStack router instance. Rendered by the root route,
 * so `useRouter()` is available to anything below (docs/PLAN.md §4.1).
 */
export const RouteProviders: FunctionComponent<PropsWithChildren> = ({ children }) => (
	<NuqsAdapter>{children}</NuqsAdapter>
);

/**
 * Providers that do not depend on the router. `MantineProvider` owns the theme
 * and the color scheme; the scheme persists in localStorage under the key that
 * the inline script in index.html reads before the first paint.
 */
export const AppProviders: FunctionComponent<PropsWithChildren> = ({ children }) => (
	<MantineProvider theme={theme} defaultColorScheme="auto">
		<Notifications position="bottom-right" limit={4} />
		<QueryClientProvider client={queryClient}>
			<TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
				{children}
			</TRPCProvider>
		</QueryClientProvider>
	</MantineProvider>
);
