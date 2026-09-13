import { Center, Flex, Loader } from "@mantine/core";
import { Outlet } from "@tanstack/react-router";
import type { FunctionComponent } from "react";
import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { useJobsStream } from "@/features/jobs/hooks/use-jobs";

/**
 * Sidebar plus content area (docs/PLAN.md §7.1). Tool pages render in the outlet.
 *
 * The shell owns the job stream, because the sidebar count and the queue screen
 * both read it and neither one is always on the display.
 */
export const AppShell: FunctionComponent = () => {
	useJobsStream();
	return (
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
};
