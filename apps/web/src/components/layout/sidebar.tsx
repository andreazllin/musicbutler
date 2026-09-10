import { ActionIcon, Center, Stack, Tooltip } from "@mantine/core";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { FunctionComponent } from "react";
import { TOOLS } from "@/features/registry";
import { ThemeToggle } from "./theme-toggle";

/**
 * The app sidebar (docs/PLAN.md §7.1). It renders one icon button per registered
 * tool. Navigation goes through the TanStack router, so a click never reloads
 * the page.
 */
export const Sidebar: FunctionComponent = () => {
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const navigate = useNavigate();
    return (
        <Stack
            component="aside"
            aria-label="Tools"
            h="100%"
            w={68}
            gap="xs"
            align="center"
            py="md"
            style={{
                flexShrink: 0,
                borderRight: "1px solid var(--mantine-color-default-border)",
            }}
        >
            <Center
                aria-hidden="true"
                w={36}
                h={36}
                fw={600}
                c="white"
                bg="var(--mantine-primary-color-filled)"
                style={{ borderRadius: "var(--mantine-radius-md)" }}
            >
                mb
            </Center>
            <Stack component="nav" gap={4} mt="sm" align="center">
                {TOOLS.map((tool) => {
                    const current = pathname.startsWith(tool.path);
                    return (
                        <Tooltip key={tool.id} label={tool.label} position="right" withArrow>
                            <ActionIcon
                                size="lg"
                                variant={current ? "light" : "subtle"}
                                color={current ? undefined : "gray"}
                                aria-label={tool.label}
                                aria-current={current ? "page" : undefined}
                                onClick={() => void navigate({ to: tool.path })}
                            >
                                <tool.icon size={20} />
                            </ActionIcon>
                        </Tooltip>
                    );
                })}
            </Stack>
            <Stack gap="xs" mt="auto" align="center">
                <ThemeToggle />
            </Stack>
        </Stack>
    );
};
