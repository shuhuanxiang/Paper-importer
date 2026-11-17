import { App } from 'obsidian';
import { MetadataCandidate, MetadataField, MetadataSource, PaperMetadata, ResolvedMetadata } from '../types';
import { MetadataConflictModal } from '../ui/modals';

export const METADATA_FIELDS: MetadataField[] = [
	'title', 'authors', 'year', 'date', 'doi', 'arxivId', 'journal', 'issn', 'url',
];

const SOURCE_PRIORITY: MetadataSource[] = ['Crossref', 'arXiv', 'PDF', 'MinerU'];

export async function resolveMetadataCandidates(
	app: App,
	candidates: MetadataCandidate[],
	signal?: AbortSignal,
): Promise<ResolvedMetadata | null> {
	const ordered = [...candidates].sort(
		(left, right) => SOURCE_PRIORITY.indexOf(left.source) - SOURCE_PRIORITY.indexOf(right.source),
	);
	const metadata: PaperMetadata = {};
	const sources: ResolvedMetadata['sources'] = {};
	const conflicts: MetadataField[] = [];

	for (const field of METADATA_FIELDS) {
		const available = ordered.filter((candidate) => hasValue(candidate.metadata[field]));
		if (available.length === 0) continue;
		const distinct = new Set(available.map((candidate) => normalizeValue(candidate.metadata[field])));
		if (distinct.size > 1) {
			conflicts.push(field);
			continue;
		}
		const selected = available[0];
		if (selected) {
			assignField(metadata, field, selected.metadata[field]);
			sources[field] = selected.source;
		}
	}

	if (conflicts.length === 0) return { metadata, sources };
	const selected = await MetadataConflictModal.resolve(app, conflicts, ordered, signal);
	if (!selected) return null;
	for (const field of conflicts) {
		const value = selected.metadata[field];
		if (hasValue(value)) {
			assignField(metadata, field, value);
			const source = selected.sources[field];
			if (source) sources[field] = source;
		}
	}
	return { metadata, sources };
}

function hasValue(value: PaperMetadata[MetadataField] | undefined): boolean {
	return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}

function normalizeValue(value: PaperMetadata[MetadataField] | undefined): string {
	const text = Array.isArray(value) ? value.join('\n') : value ?? '';
	return text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function assignField(metadata: PaperMetadata, field: MetadataField, value: PaperMetadata[MetadataField] | undefined): void {
	if (value === undefined) return;
	(metadata as Record<MetadataField, PaperMetadata[MetadataField]>)[field] = value;
}
