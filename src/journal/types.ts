export const RANKING_SYSTEMS = ['CCF', 'CCF-T', 'JCR', 'CAS', 'XR', 'XR-conference', 'Warning'] as const;
export type RankingSystem = typeof RANKING_SYSTEMS[number];

export interface RankedJournal {
	names: string[];
	issns: string[];
	rank: string;
	top?: boolean;
	note?: string;
}

export interface JournalRankingSource {
	name: string;
	system: RankingSystem;
	year: number;
	entries: RankedJournal[];
}

export interface JournalLibrary {
	version: 1;
	sources: JournalRankingSource[];
}

export interface JournalRankingMatch {
	system: RankingSystem;
	year: number;
	rank: string;
	top?: boolean;
	note?: string;
	source: string;
}

export interface JournalLibrarySummary {
	sources: number;
	entries: number;
}
