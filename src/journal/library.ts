import { decodeCsv, normalizeIssn, parseCsv } from './csv';
import { JournalLibrary, JournalRankingSource, RankedJournal, RANKING_SYSTEMS, RankingSystem } from './types';

type Row = Record<string, string>;

export function parseJournalCsv(name: string, bytes: Uint8Array): JournalLibrary {
	const [headers, ...rows] = parseCsv(decodeCsv(bytes));
	if (!headers?.includes('Journal')) throw new Error(`${name}: missing Journal column.`);
	if (new Set(headers).size !== headers.length) throw new Error(`${name}: duplicate CSV headers.`);
	const system = detectSystem(headers);
	const grouped = new Map<number, RankedJournal[]>();
	for (const [index, values] of rows.entries()) {
		if (values.length !== headers.length) throw new Error(`${name}: incorrect column count in record ${index + 2}.`);
		const row: Row = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']));
		if (![row.Journal, row['刊物名称'], row['刊名'], row['中文刊名'], row['会议缩写']].some(Boolean)) {
			throw new Error(`${name}: empty journal name in record ${index + 2}.`);
		}
		const year = Number(row['年份'] || headers.join(' ').match(/20\d{2}/)?.[0] || name.match(/20\d{2}/)?.[0]);
		if (!Number.isInteger(year) || year < 1900 || year > 2199) throw new Error(`${name}: missing or invalid ranking year.`);
		const entry = parseEntry(row, system);
		if (!entry) continue; // For example, JCR N/A does not constitute a quartile.
		const entries = grouped.get(year) ?? [];
		entries.push(entry);
		grouped.set(year, entries);
	}
	if (!grouped.size) throw new Error(`${name}: no usable journal rankings found.`);
	return {
		version: 1,
		sources: [...grouped].map(([year, entries]) => ({ name, system, year, entries })),
	};
}

function detectSystem(headers: string[]): RankingSystem {
	if (headers.includes('CCF推荐类型')) return 'CCF';
	if (headers.includes('T分区')) return 'CCF-T';
	if (headers.some((header) => /^IF Quartile/i.test(header))) return 'JCR';
	if (headers.includes('大类分区')) return 'CAS';
	if (headers.includes('大类新锐分区')) return 'XR';
	if (headers.includes('会议缩写') && headers.includes('分区')) return 'XR-conference';
	if (headers.some((header) => /^预警(?:等级|原因)/.test(header))) return 'Warning';
	throw new Error('Unsupported journal CSV columns.');
}

function parseEntry(row: Row, system: RankingSystem): RankedJournal | undefined {
	const names = [...new Set([row.Journal, row['刊物名称'], row['刊名'], row['中文刊名'], row['会议缩写']].filter(
		(value): value is string => Boolean(value),
	))];
	const issns = [...new Set([row.ISSN, row.EISSN, row['ISSN/EISSN']].flatMap((value) =>
		(value ?? '').split(/[/;,\s]+/).map(normalizeIssn).filter((issn): issn is string => Boolean(issn)),
	))];
	let rank: string | undefined;
	let top = false;
	let note: string | undefined;
	switch (system) {
		case 'CCF':
			rank = row['CCF推荐类型']?.match(/^[ABC]/)?.[0];
			break;
		case 'CCF-T':
			rank = row['T分区']?.match(/^T[123]$/)?.[0];
			break;
		case 'JCR':
			rank = Object.entries(row).filter(([key]) => /^IF Quartile/i.test(key))
				.map(([, value]) => value.toUpperCase()).filter((value) => /^Q[1-4]$/.test(value)).sort()[0];
			break;
		case 'CAS':
			rank = partition(row['大类分区']);
			top = isTop(row.Top);
			break;
		case 'XR':
			rank = [partition(row['大类新锐分区']), partition(row['大类2新锐分区'])]
				.filter((value): value is string => Boolean(value)).sort()[0];
			top = isTop(row.Top) || isTop(row['大类2Top']);
			note = row['预警标记'] || undefined;
			break;
		case 'XR-conference':
			rank = partition(row['分区']);
			top = isTop(row.Top);
			break;
		case 'Warning': {
			const warning = Object.entries(row).find(([key]) => /^预警(?:等级|原因)/.test(key));
			if (warning?.[1]) {
				rank = warning[0].startsWith('预警等级') ? warning[1] : '预警';
				note = warning[0].startsWith('预警原因') ? warning[1] : undefined;
			}
			break;
		}
	}
	if (!rank) return undefined;
	return { names, issns, rank, ...(top ? { top } : {}), ...(note ? { note } : {}) };
}

function partition(value = ''): string | undefined {
	const number = value.match(/^([1-4])(?:\D|$)/)?.[1];
	return number ? `${number}区` : undefined;
}

function isTop(value = ''): boolean {
	return /^(?:是|top|yes)$/i.test(value);
}

export function parseJournalLibrary(text: string): JournalLibrary {
	const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sources)) {
		throw new Error('Unsupported journal library format (expected version 1).');
	}
	const sources: JournalRankingSource[] = [];
	for (const source of value.sources as unknown[]) {
		if (!isRecord(source) || !isText(source.name) || !isSystem(source.system)
			|| !Number.isInteger(source.year) || Number(source.year) < 1900 || Number(source.year) > 2199
			|| !Array.isArray(source.entries) || !source.entries.length) {
			throw new Error('Invalid journal library source.');
		}
		const entries: RankedJournal[] = [];
		for (const entry of source.entries as unknown[]) {
			if (!isRecord(entry) || !isTextArray(entry.names) || !entry.names.length || !isTextArray(entry.issns)
				|| !isText(entry.rank) || !validRank(source.system, entry.rank)
				|| (entry.top !== undefined && typeof entry.top !== 'boolean')
				|| (entry.note !== undefined && !isText(entry.note))) {
				throw new Error(`Invalid journal ranking in ${source.name}.`);
			}
			const issns = entry.issns.map(normalizeIssn);
			if (issns.some((issn) => !issn)) throw new Error(`Invalid ISSN in ${source.name}.`);
			entries.push({
				names: [...new Set(entry.names.map((name) => name.trim()))],
				issns: [...new Set(issns as string[])],
				rank: entry.rank.trim(),
				...(entry.top === true ? { top: true } : {}),
				...(isText(entry.note) ? { note: entry.note.trim() } : {}),
			});
		}
		sources.push({ name: source.name.trim(), system: source.system, year: Number(source.year), entries });
	}
	return { version: 1, sources };
}

/** Importing a source again replaces that source; other tables are retained. */
export function mergeJournalLibraries(...libraries: JournalLibrary[]): JournalLibrary {
	const sources = new Map<string, JournalRankingSource>();
	for (const library of libraries) {
		for (const source of library.sources) {
			sources.set(JSON.stringify([source.name, source.system, source.year]), source);
		}
	}
	return { version: 1, sources: [...sources.values()] };
}

function validRank(system: RankingSystem, rank: string): boolean {
	if (system === 'CCF') return /^[ABC]$/.test(rank);
	if (system === 'CCF-T') return /^T[123]$/.test(rank);
	if (system === 'JCR') return /^Q[1-4]$/.test(rank);
	if (system === 'Warning') return /^(?:低|中|高|预警)$/.test(rank);
	return /^[1-4]区$/.test(rank);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
	return typeof value === 'string' && Boolean(value.trim());
}

function isTextArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item: unknown) => isText(item));
}

function isSystem(value: unknown): value is RankingSystem {
	return typeof value === 'string' && RANKING_SYSTEMS.some((system) => system === value);
}
