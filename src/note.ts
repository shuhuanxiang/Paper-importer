import type { TFile } from 'obsidian';
import { MetadataCandidate, PaperMetadata, ResolvedMetadata } from './types';
import { uiStrings } from './i18n';
import { journalRankLabel, journalRankTags } from './journal/index';
import { JournalRankingMatch } from './journal/types';

export function renderNote(
	metadata: PaperMetadata,
	sources: ResolvedMetadata['sources'],
	file: TFile,
	body: string,
	candidates: MetadataCandidate[],
	rankings: JournalRankingMatch[],
): string {
	const title = metadata.title || file.basename;
	const frontmatter = ['---', `title: ${yamlString(title)}`];
	if (metadata.authors?.length) {
		frontmatter.push('authors:', ...metadata.authors.map((author) => `  - ${yamlString(author)}`));
	}
	if (metadata.year) frontmatter.push(`year: ${/^\d{4}$/.test(metadata.year) ? metadata.year : yamlString(metadata.year)}`);
	if (metadata.date) frontmatter.push(`date: ${yamlString(metadata.date)}`);
	if (metadata.doi) frontmatter.push(`doi: ${yamlString(metadata.doi)}`);
	if (metadata.arxivId) frontmatter.push(`arxiv_id: ${yamlString(metadata.arxivId)}`);
	if (metadata.journal) frontmatter.push(`journal: ${yamlString(metadata.journal)}`);
	if (metadata.issn?.length) frontmatter.push('issn:', ...metadata.issn.map((issn) => `  - ${yamlString(issn)}`));
	if (rankings.length) {
		frontmatter.push('journal_rank:', ...rankings.map((match) => `  - ${yamlString(journalRankLabel(match))}`));
		frontmatter.push('tags:', ...journalRankTags(rankings).map((tag) => `  - ${yamlString(tag)}`));
		const rankingSources = [...new Set(rankings.map((match) => match.source))];
		frontmatter.push('journal_rank_sources:', ...rankingSources.map((source) => `  - ${yamlString(source)}`));
		const notes = rankings.filter((match) => match.note)
			.map((match) => `  - ${yamlString(`${journalRankLabel(match)}: ${match.note ?? ''}`)}`);
		if (notes.length) frontmatter.push('journal_rank_notes:', ...notes);
	}
	if (metadata.url) frontmatter.push(`url: ${yamlString(metadata.url)}`);
	frontmatter.push(`source_pdf: ${yamlString(`[[${file.path}]]`)}`);

	const sourceLines = Object.entries(sources)
		.filter(([field]) => field in metadata)
		.map(([field, source]) => `  ${field}: ${yamlString(source ?? '')}`);
	if (sourceLines.length) frontmatter.push('metadata_sources:', ...sourceLines);
	const providers = [...new Set(candidates.map((candidate) => candidate.source).filter((source) => source !== 'MinerU'))];
	if (providers.length) frontmatter.push(`metadata_providers: [${providers.map(yamlString).join(', ')}]`);
	frontmatter.push('---');
	return `${frontmatter.join('\n')}\n\n${body.trim()}\n`;
}

export function metadataOnlyBody(metadata: PaperMetadata, file: TFile): string {
	const text = uiStrings();
	return [`# ${metadata.title || file.basename}`, '', `## ${text.sourcePdfHeading}`, '', `[[${file.path}]]`].join('\n');
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}
