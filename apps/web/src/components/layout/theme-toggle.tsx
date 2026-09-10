import { ActionIcon, type MantineColorScheme, Tooltip, useMantineColorScheme } from "@mantine/core";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import type { FunctionComponent } from "react";

const NEXT: Record<MantineColorScheme, MantineColorScheme> = {
    auto: "light",
    light: "dark",
    dark: "auto",
};
const ICON = { auto: IconDeviceDesktop, light: IconSun, dark: IconMoon } as const;
const LABEL: Record<MantineColorScheme, string> = {
    auto: "Theme: follow system",
    light: "Theme: light",
    dark: "Theme: dark",
};

/**
 * Cycles system → light → dark (docs/PLAN.md §4.1). Mantine persists the choice
 * in localStorage; the inline script in index.html replays it before the first
 * paint so the page never flashes the wrong scheme.
 */
export const ThemeToggle: FunctionComponent = () => {
    const { colorScheme, setColorScheme } = useMantineColorScheme();
    const Icon = ICON[colorScheme];
    return (
        <Tooltip label={LABEL[colorScheme]} position="right" withArrow>
            <ActionIcon size="lg" variant="subtle" color="gray" aria-label={LABEL[colorScheme]} onClick={() => setColorScheme(NEXT[colorScheme])}>
                <Icon size={18} />
            </ActionIcon>
        </Tooltip>
    );
};
