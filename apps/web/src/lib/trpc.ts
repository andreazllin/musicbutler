import type { AppRouter } from "@musicbutler/server/router";
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { env } from "./env.ts";

/**
 * tRPC owns all RPC traffic (docs/PLAN.md §4.2). Subscriptions go over SSE
 * through `httpSubscriptionLink`; everything else is batched.
 * Credentials are always sent so the browser's basic-auth session is reused (§7.1).
 */
const url = `${env.VITE_API_BASE}/trpc`;

export const trpcClient = createTRPCClient<AppRouter>({
	links: [
		splitLink({
			condition: (op) => op.type === "subscription",
			true: httpSubscriptionLink({
				url,
				eventSourceOptions: { withCredentials: true },
			}),
			false: httpBatchLink({
				url,
				fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
			}),
		}),
	],
});

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();
