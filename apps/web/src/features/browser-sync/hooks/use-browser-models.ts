import type { BrowserModel, BrowserModelId, Lang } from "@musicbutler/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTRPC } from "@/lib/trpc";
import { useBrowserModelsStore } from "@/stores/browser-models-store";
import { type LocalModelState, localState } from "../helpers/local-state";

/**
 * The models a browser sync can use: what the server serves (`models.browser`)
 * and what this browser holds. A model is ready when both have the same
 * version.
 */
export function useBrowserModels() {
	const trpc = useTRPC();
	const query = useQuery({ ...trpc.models.browser.queryOptions(), staleTime: 60_000 });
	const local = useBrowserModelsStore((s) => s.local);
	const isLoaded = useBrowserModelsStore((s) => s.isLoaded);
	const refresh = useBrowserModelsStore((s) => s.refresh);

	useEffect(() => {
		if (!isLoaded) void refresh();
	}, [isLoaded, refresh]);

	const models = query.data?.models ?? [];
	const byId = (id: BrowserModelId) => models.find((m) => m.id === id);
	const stateOf = (model: BrowserModel): LocalModelState => localState(model, local[model.id]);

	/** The models a sync in `lang` needs, with `separation` only when it isolates vocals. */
	const neededFor = (lang: Lang, isolateVocals: boolean) => ({
		asr: byId(lang) ?? null,
		separation: isolateVocals ? (byId("separation") ?? null) : null,
	});

	/** Of the models a sync needs, those that this browser must download first. */
	const missingFor = (lang: Lang, isolateVocals: boolean): BrowserModel[] => {
		const { asr, separation } = neededFor(lang, isolateVocals);
		return [asr, separation].filter((m): m is BrowserModel => m !== null && stateOf(m) !== "ready");
	};

	return {
		models,
		isPending: query.isPending || !isLoaded,
		isError: query.isError,
		stateOf,
		neededFor,
		missingFor,
	};
}
