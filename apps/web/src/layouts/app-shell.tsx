import { Center, Flex, Loader } from "@mantine/core";
import { Outlet } from "@tanstack/react-router";
import type { FunctionComponent } from "react";
import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";

/** Sidebar plus content area (docs/PLAN.md §7.1). Tool pages render in the outlet. */
export const AppShell: FunctionComponent = () => (
	<Flex h="100dvh" w="100%" style={{ overflow: "hidden" }}>
		<Sidebar />
		<Flex component="main" direction="column" flex={1} miw={0} style={{ overflow: "hidden" }}>
			<Suspense
				fallback={
					<Center flex={1}>
						<Loader type="bars" size="md" aria-label="Please wait" />
					</Center>
				}
			>
				<Outlet />
			</Suspense>
		</Flex>
	</Flex>
);
