import { Box, Stack, Text } from "@mantine/core";
import type { FunctionComponent } from "react";
import { BrowserModels } from "@/features/settings/components/BrowserModels";
import { SyncSettings } from "@/features/settings/components/SyncSettings";

/**
 * The Settings screen: where a lyrics sync runs, the default sync language, and
 * the models this browser holds. Every setting belongs to this browser.
 */
export const SettingsPage: FunctionComponent = () => (
	<Stack gap={0} h="100%" mih={0}>
		<Box px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
			<Text component="h1" fz="sm" fw={500} m={0}>
				Settings
			</Text>
		</Box>
		<Box flex={1} mih={0} p="md" style={{ overflowY: "auto" }}>
			<Stack gap="md" maw={760}>
				<SyncSettings />
				<BrowserModels />
			</Stack>
		</Box>
	</Stack>
);
