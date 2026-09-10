import { Button, Stack, Text, Title } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import type { FunctionComponent } from "react";
import { DEFAULT_TOOL_PATH } from "@/features/registry";

export const NotFoundPage: FunctionComponent = () => (
	<Stack flex={1} align="center" justify="center" gap="md" p="xl" ta="center">
		<Title order={1} size="h2">
			Page not found
		</Title>
		<Text c="dimmed">This address does not match a tool.</Text>
		<Button component={Link} to={DEFAULT_TOOL_PATH} variant="default">
			Go to Lyrics Sync
		</Button>
	</Stack>
);
