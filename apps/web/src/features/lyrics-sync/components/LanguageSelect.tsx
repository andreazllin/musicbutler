import { Select } from "@mantine/core";
import type { Lang } from "@musicbutler/shared";
import type { FunctionComponent } from "react";
import { useLanguages } from "../hooks/use-languages";

type Props = {
	value: Lang | null;
	onChange: (lang: Lang) => void;
	isDisabled?: boolean;
};

/**
 * The sync language (docs/PLAN.md §7.5). Options come from `sync.languages`;
 * a language whose model this build lacks is disabled and says so.
 */
export const LanguageSelect: FunctionComponent<Props> = ({ value, onChange, isDisabled }) => {
	const langs = useLanguages();
	const data = (langs.data?.langs ?? []).map((l) => ({
		value: l.code,
		label: l.available ? l.label : `${l.label} — model not installed`,
		disabled: !l.available,
	}));
	return (
		<Select
			aria-label="Sync language"
			w={224}
			data={data}
			value={value}
			onChange={(next) => {
				if (next !== null) onChange(next as Lang);
			}}
			placeholder={langs.isPending ? "Loading…" : "Language"}
			allowDeselect={false}
			checkIconPosition="right"
			disabled={isDisabled || langs.isPending || langs.isError}
		/>
	);
};
