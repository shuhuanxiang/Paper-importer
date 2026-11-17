import { normalizeIssn, normalizeJournalName } from './csv';
import { JournalLibrary, JournalRankingMatch, JournalRankingSource, RankedJournal, RankingSystem } from './types';

interface IndexedJournal {
	source: JournalRankingSource;
	entry: RankedJournal;
}

/** Build once, on first use. Only the newest table for each grading system is active. */
export class JournalRankingIndex {
	private readonly names = new Map<string, IndexedJournal[]>();
	private readonly issns = new Map<string, IndexedJournal[]>();

	constructor(library: JournalLibrary) {
		const newest = new Map<RankingSystem, number>();
		for (const source of library.sources) {
			newest.set(source.system, Math.max(newest.get(source.system) ?? 0, source.year));
		}
		for (const source of library.sources) {
			// Warning tables are historical lists: absence in a newer list does not erase an old warning.
			if (source.system !== 'Warning' && source.year !== newest.get(source.system)) continue;
			for (const entry of source.entries) {
				const item = { source, entry };
				for (const name of new Set(entry.names.map(normalizeJournalName).filter(Boolean))) {
					this.add(this.names, name, item);
				}
				for (const issn of entry.issns) this.add(this.issns, issn, item);
			}
		}
	}

	lookup(journal?: string, paperIssns: string[] = []): JournalRankingMatch[] {
		const issns = new Set(paperIssns.map(normalizeIssn).filter((value): value is string => Boolean(value)));
		const byIssn = new Set<IndexedJournal>();
		for (const issn of issns) {
			for (const item of this.issns.get(issn) ?? []) byIssn.add(item);
		}
		// Verified ISSN matches supply aliases for tables (CCF and warnings) without ISSNs.
		const names = byIssn.size
			? [...byIssn].flatMap((item) => item.entry.names)
			: journal ? [journal] : [];
		const matches = new Set(byIssn);
		for (const name of names) {
			for (const item of this.names.get(normalizeJournalName(name)) ?? []) {
				if (!issns.size || !item.entry.issns.length || item.entry.issns.some((issn) => issns.has(issn))) {
					matches.add(item);
				}
			}
		}
		const grouped = new Map<JournalRankingSource, Set<RankedJournal>>();
		for (const { source, entry } of matches) {
			const entries = grouped.get(source) ?? new Set<RankedJournal>();
			entries.add(entry);
			grouped.set(source, entries);
		}
		const result: JournalRankingMatch[] = [];
		for (const [source, entries] of grouped) {
			// An acronym shared by different journals must not assign an arbitrary grade.
			const canonicalNames = new Set([...entries].map((entry) => normalizeJournalName(entry.names[0] ?? '')));
			if (canonicalNames.size > 1) continue;
			const grades = new Set([...entries].map((entry) => JSON.stringify([entry.rank, entry.top, entry.note])));
			if (grades.size > 1) continue;
			const entry = [...entries][0];
			if (entry) result.push({
				system: source.system, year: source.year, rank: entry.rank, source: source.name,
				top: entry.top, note: entry.note,
			});
		}
		return result.sort((left, right) => left.system.localeCompare(right.system) || right.year - left.year);
	}

	private add(index: Map<string, IndexedJournal[]>, key: string, item: IndexedJournal): void {
		const items = index.get(key) ?? [];
		items.push(item);
		index.set(key, items);
	}
}

const SYSTEM_LABELS: Record<RankingSystem, string> = {
	CCF: 'CCF', 'CCF-T': 'CCF T类', JCR: 'JCR', CAS: '中科院',
	XR: '新锐', 'XR-conference': '新锐会议', Warning: '期刊预警',
};

export function journalRankLabel(match: JournalRankingMatch): string {
	return `${SYSTEM_LABELS[match.system]} ${match.year} ${match.rank}${match.top ? ' Top' : ''}`;
}

export function journalRankTags(matches: JournalRankingMatch[]): string[] {
	return [...new Set(matches.flatMap((match) => {
		const prefix = `journal/${match.system}-${match.year}`;
		const tags = [`${prefix}/${match.rank}`];
		if (match.top) tags.push(`${prefix}/Top`);
		return tags;
	}))];
}
