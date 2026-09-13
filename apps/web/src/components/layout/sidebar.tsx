import { ActionIcon, Anchor, Center, Indicator, Stack, Tooltip } from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { FunctionComponent } from "react";
import { activeCount } from "@/features/jobs/helpers/queue";
import { useJobs } from "@/features/jobs/hooks/use-jobs";
import { TOOLS } from "@/features/registry";
import { SOURCE_URL } from "@/lib/source";
import { ThemeToggle } from "./theme-toggle";

/** The source offer that AGPL-3.0 section 13 asks a network application to make. */
const SourceLink: FunctionComponent = () => (
    <Tooltip label="Source code (AGPL-3.0)" position="right" withArrow>
        <Anchor href={SOURCE_URL} target="_blank" rel="noreferrer" aria-label="Source code, licensed AGPL-3.0" c="dimmed" display="flex">
            <IconBrandGithub size={18} />
        </Anchor>
    </Tooltip>
);

/**
 * The app sidebar (docs/PLAN.md §7.1). It renders one icon button per registered
 * tool. Navigation goes through the TanStack router, so a click never reloads
 * the page.
 */
export const Sidebar: FunctionComponent = () => {
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const navigate = useNavigate();
    // The badge is the only thing that says a job is running while you work on
    // a different screen.
    const { jobs } = useJobs();
    const active = activeCount(jobs);
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
                    const count = tool.id === "jobs" ? active : 0;
                    const label = count > 0 ? `${tool.label} (${count} in the queue)` : tool.label;
                    return (
                        <Tooltip key={tool.id} label={label} position="right" withArrow>
                            <Indicator label={count > 0 ? count : undefined} size={16} offset={4} color="blue" disabled={count === 0} aria-hidden="true">
                                <ActionIcon
                                    size="lg"
                                    variant={current ? "light" : "subtle"}
                                    color={current ? undefined : "gray"}
                                    aria-label={label}
                                    aria-current={current ? "page" : undefined}
                                    onClick={() => void navigate({ to: tool.path })}
                                >
                                    <tool.icon size={20} />
                                </ActionIcon>
                            </Indicator>
                        </Tooltip>
                    );
                })}
            </Stack>
            <Stack gap="xs" mt="auto" align="center">
                <SourceLink />
                <ThemeToggle />
            </Stack>
        </Stack>
    );
};
