import { Alert, Paper, SegmentedControl, Select, Stack, Text, Title } from "@mantine/core";
import type { Lang, SyncMode } from "@musicbutler/shared";
import { IconInfoCircle } from "@tabler/icons-react";
import type { FunctionComponent } from "react";
import { useLanguages } from "@/features/lyrics-sync/hooks/use-languages";
import { useSettingsStore } from "@/stores/settings-store";

/** The value of the language select that means "no fixed default". */
const FIRST_AVAILABLE = "first";

const MODE_HELP: Record<SyncMode, string> = {
	browser:
		"This browser runs the models. The server only sends the audio and saves the lyrics. The first sync downloads the models.",
	server:
		"The server runs the models. It runs one sync at a time, for all the people who use this app.",
};

/** Where a sync runs and which language the Lyrics Sync screen selects first. */
export const SyncSettings: FunctionComponent = () => {
	const syncMode = useSettingsStore((s) => s.syncMode);
	const setSyncMode = useSettingsStore((s) => s.setSyncMode);
	const defaultLang = useSettingsStore((s) => s.defaultLang);
	const setDefaultLang = useSettingsStore((s) => s.setDefaultLang);
	const languages = useLanguages();

	const langOptions = [
		{ value: FIRST_AVAILABLE, label: "The first language that has a model" },
		...(languages.data?.langs ?? []).map((l) => ({
			value: l.code,
			label: l.available ? l.label : `${l.label} (the server does not have the model)`,
			disabled: !l.available,
		})),
	];

	return (
		<Paper withBorder p="md">
			<Stack gap="lg">
				<Title order={2} fz="md" fw={600}>
					Lyrics sync
				</Title>

				<Stack gap={6}>
					<Text fz="sm" fw={500} id="sync-mode-label">
						Where the sync runs
					</Text>
					<SegmentedControl
						aria-labelledby="sync-mode-label"
						value={syncMode}
						onChange={(value) => setSyncMode(value as SyncMode)}
						data={[
							{ value: "browser", label: "This browser" },
							{ value: "server", label: "Server" },
						]}
						maw={360}
					/>
					<Text fz="xs" c="dimmed">
						{MODE_HELP[syncMode]}
					</Text>
					{syncMode === "browser" && !self.crossOriginIsolated && (
						<Alert
							variant="light"
							color="yellow"
							icon={<IconInfoCircle size={18} />}
							title="The sync uses one processor core"
							maw={560}
						>
							The browser gives this page one core only, because the page does not use HTTPS. The
							sync works, but it is slower. Open the app over HTTPS to use more cores.
						</Alert>
					)}
				</Stack>

				<Select
					label="Default sync language"
					description="The Lyrics Sync screen selects this language when it opens."
					data={langOptions}
					value={defaultLang ?? FIRST_AVAILABLE}
					onChange={(value) =>
						setDefaultLang(value === null || value === FIRST_AVAILABLE ? null : (value as Lang))
					}
					allowDeselect={false}
					checkIconPosition="right"
					disabled={languages.isPending || languages.isError}
					maw={360}
				/>
			</Stack>
		</Paper>
	);
};
