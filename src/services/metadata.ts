import { MetadataCandidate, PaperImporterSettings, PaperMetadata } from '../types';
import { httpRequest } from './http';
import { ImportCancelledError } from '../utils/tasks';

interface CrossrefWork {
	title?: string[];
	author?: { given?: string; family?: string; name?: string }[];
	published?: { 'date-parts'?: number[][] };
	'published-print'?: { 'date-parts'?: number[][] };
	'published-online'?: { 'date-parts'?: number[][] };
	DOI?: string;
	'container-title'?: string[];
	ISSN?: string[];
	URL?: string;
}

interface CrossrefResponse {
	message?: unknown;
}

const ATOM_NS = 'http://www.w3.org/2005/Atom';
const ARXIV_NS = 'http://arxiv.org/schemas/atom';

export interface MetadataLookupResult {
	candidates: MetadataCandidate[];
	errors: string[];
}

export async function lookupMetadata(
	query: string,
	settings: PaperImporterSettings,
	preferredTitle?: string,
	signal?: AbortSignal,
): Promise<MetadataLookupResult> {
	const candidates: MetadataCandidate[] = [];
	const errors: string[] = [];
	const doi = findDoi(query);
	const arxivId = findArxivId(query);
	const titleQuery = preferredTitle?.trim() || query.replace(/^arxiv:\s*/i, '').trim();
	const requests: Promise<void>[] = [];

	if (settings.crossrefEnabled) {
		requests.push(
			lookupCrossref(doi, titleQuery, settings.crossrefEmail, signal, settings.requestTimeoutSeconds * 1000)
				.then((candidate) => {
					if (candidate) candidates.push(candidate);
				})
				.catch((error: unknown) => {
					if (error instanceof ImportCancelledError) throw error;
					errors.push(`Crossref: ${messageOf(error)}`);
				}),
		);
	}
	if (settings.arxivEnabled) {
		requests.push(
			lookupArxiv(arxivId, titleQuery, signal, settings.requestTimeoutSeconds * 1000)
				.then((candidate) => {
					if (candidate) candidates.push(candidate);
				})
				.catch((error: unknown) => {
					if (error instanceof ImportCancelledError) throw error;
					errors.push(`arXiv: ${messageOf(error)}`);
				}),
		);
	}
	await Promise.all(requests);
	return { candidates, errors };
}

async function lookupCrossref(
	doi: string | undefined,
	query: string,
	mailto: string,
	signal?: AbortSignal,
	timeoutMs = 60_000,
): Promise<MetadataCandidate | undefined> {
	const url = doi
		? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
		: buildCrossrefSearchUrl(query, mailto);
	const response = await httpRequest({ url }, signal, timeoutMs);
	const payload = parseCrossrefResponse(response.text);
	const work = crossrefWorkFrom(payload.message);
	if (!work) return undefined;
	const dateParts = work['published-print']?.['date-parts']?.[0]
		?? work['published-online']?.['date-parts']?.[0]
		?? work.published?.['date-parts']?.[0];
	const date = dateParts?.map((part) => String(part).padStart(2, '0')).join('-');
	const year = dateParts?.[0] ? String(dateParts[0]) : undefined;
	const metadata: PaperMetadata = {
		title: work.title?.[0]?.trim(),
		authors: work.author?.map((author) => author.name ?? [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean),
		year,
		date,
		doi: work.DOI?.trim(),
		journal: work['container-title']?.[0]?.trim(),
		issn: work.ISSN,
		url: work.URL,
	};
	return { source: 'Crossref', metadata: removeEmpty(metadata) };
}

function buildCrossrefSearchUrl(query: string, mailto: string): string {
	const params = new URLSearchParams({ 'query.bibliographic': query, rows: '1' });
	if (mailto.trim()) params.set('mailto', mailto.trim());
	return `https://api.crossref.org/works?${params.toString()}`;
}

async function lookupArxiv(
	arxivId: string | undefined,
	query: string,
	signal?: AbortSignal,
	timeoutMs = 60_000,
): Promise<MetadataCandidate | undefined> {
	if (!arxivId && !query.trim()) return undefined;
	const params = new URLSearchParams({ max_results: '1' });
	if (arxivId) params.set('id_list', arxivId);
	else params.set('search_query', `ti:"${query.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);

	const response = await httpRequest({
		url: `https://export.arxiv.org/api/query?${params.toString()}`,
	}, signal, timeoutMs);
	const document = new DOMParser().parseFromString(response.text, 'application/xml');
	const entry = document.getElementsByTagNameNS(ATOM_NS, 'entry')[0];
	if (!entry) return undefined;
	const title = textOf(entry, ATOM_NS, 'title')?.replace(/\s+/g, ' ').trim();
	const idUrl = textOf(entry, ATOM_NS, 'id')?.trim();
	if (!title || title === 'Error') return undefined;
	const published = textOf(entry, ATOM_NS, 'published')?.slice(0, 10);
	const authors = Array.from(entry.getElementsByTagNameNS(ATOM_NS, 'author'))
		.map((author) => textOf(author, ATOM_NS, 'name')?.trim() ?? '')
		.filter(Boolean);
	const doi = textOf(entry, ARXIV_NS, 'doi')?.trim();
	const resolvedId = idUrl ? findArxivId(idUrl) : arxivId;
	return {
		source: 'arXiv',
		metadata: removeEmpty({
			title,
			authors,
			year: published?.slice(0, 4),
			date: published,
			doi,
			arxivId: resolvedId,
			url: idUrl,
		}),
	};
}

function textOf(parent: Element, namespace: string, localName: string): string | undefined {
	return parent.getElementsByTagNameNS(namespace, localName)[0]?.textContent ?? undefined;
}

function parseCrossrefResponse(text: string): CrossrefResponse {
	const value: unknown = JSON.parse(text);
	return isRecord(value) ? { message: value.message } : {};
}

function crossrefWorkFrom(value: unknown): CrossrefWork | undefined {
	if (!isRecord(value)) return undefined;
	if ('items' in value) {
		if (!isUnknownArray(value.items)) return undefined;
		const first = value.items[0];
		return isCrossrefWork(first) ? first : undefined;
	}
	return isCrossrefWork(value) ? value : undefined;
}

function isCrossrefWork(value: unknown): value is CrossrefWork {
	if (!isRecord(value)) return false;
	return optionalValue(value, 'title', isStringArray)
		&& optionalValue(value, 'author', isAuthorArray)
		&& optionalValue(value, 'published', isDateContainer)
		&& optionalValue(value, 'published-print', isDateContainer)
		&& optionalValue(value, 'published-online', isDateContainer)
		&& optionalValue(value, 'DOI', isString)
		&& optionalValue(value, 'container-title', isStringArray)
		&& optionalValue(value, 'ISSN', isStringArray)
		&& optionalValue(value, 'URL', isString);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
	return isUnknownArray(value) && value.every(isString);
}

function isAuthorArray(value: unknown): value is NonNullable<CrossrefWork['author']> {
	return isUnknownArray(value) && value.every((author) => isRecord(author)
		&& optionalValue(author, 'given', isString)
		&& optionalValue(author, 'family', isString)
		&& optionalValue(author, 'name', isString));
}

function isDateContainer(value: unknown): value is NonNullable<CrossrefWork['published']> {
	return isRecord(value) && optionalValue(value, 'date-parts', (parts) =>
		isUnknownArray(parts) && parts.every((part) =>
			isUnknownArray(part) && part.every((item) => typeof item === 'number'),
		),
	);
}

function optionalValue(
	record: Record<string, unknown>,
	key: string,
	validate: (value: unknown) => boolean,
): boolean {
	return !(key in record) || validate(record[key]);
}

function removeEmpty(metadata: PaperMetadata): Partial<PaperMetadata> {
	const result: Partial<PaperMetadata> = {};
	if (metadata.title?.trim()) result.title = metadata.title.trim();
	if (metadata.authors?.length) result.authors = metadata.authors.filter(Boolean);
	if (metadata.year?.trim()) result.year = metadata.year.trim();
	if (metadata.date?.trim()) result.date = metadata.date.trim();
	if (metadata.doi?.trim()) result.doi = metadata.doi.trim();
	if (metadata.arxivId?.trim()) result.arxivId = metadata.arxivId.trim();
	if (metadata.journal?.trim()) result.journal = metadata.journal.trim();
	if (metadata.issn?.length) result.issn = metadata.issn.map((issn) => issn.trim()).filter(Boolean);
	if (metadata.url?.trim()) result.url = metadata.url.trim();
	return result;
}

export function extractMetadataFromMarkdown(markdown: string): Partial<PaperMetadata> {
	const title = markdown.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
	const doi = findDoi(markdown);
	const arxivId = findArxivId(markdown);
	return removeEmpty({ title, doi, arxivId });
}

export function findDoi(value: string): string | undefined {
	const match = value.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0];
	return match?.replace(/[.,;:)]+$/, '');
}

export function findArxivId(value: string): string | undefined {
	const match = value.match(/arxiv\.org\/(?:abs|pdf)\/([\w.-]+(?:\/\d{7})?(?:v\d+)?)/i)?.[1]
		?? value.match(/arxiv\s*:\s*((?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?)/i)?.[1];
	return match?.replace(/v\d+$/i, '');
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : 'request failed';
}
