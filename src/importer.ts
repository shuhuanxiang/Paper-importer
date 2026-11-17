import { App, normalizePath, TFile } from 'obsidian';
import { ExtractedImage, MetadataCandidate, PaperImporterSettings, PaperMetadata, ResolvedMetadata } from './types';
import { parsePdfWithMineru } from './services/mineru';
import { readPdfMetadata } from './services/pdf-metadata';
import { checkCancelled, ImportCancelledError } from './utils/tasks';
import {
	extractMetadataFromMarkdown,
	lookupMetadata,
} from './services/metadata';
import { resolveMetadataCandidates } from './services/metadata-resolver';
import { MetadataQueryModal, OverwriteConfirmModal } from './ui/modals';
import { uiStrings } from './i18n';
import { JournalRankingService } from './journal/service';
import { JournalRankingMatch } from './journal/types';
import { metadataOnlyBody, renderNote } from './note';

export type ImportMode = 'parse' | 'metadata' | 'combined';

export interface ImportResult {
	notePath: string;
	warnings: string[];
}

export class PaperImportService {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => PaperImporterSettings,
		private readonly journalRankings: JournalRankingService,
	) {}

	async run(
		file: TFile,
		mode: ImportMode,
		reportStatus: (message: string) => void,
		signal?: AbortSignal,
	): Promise<ImportResult | null> {
		checkCancelled(signal);
		const text = uiStrings();
		if (file.extension.toLowerCase() !== 'pdf') {
			throw new Error(text.selectPdf);
		}
		const settings = this.getSettings();
		let parsedMarkdown: string | undefined;
		let parsedImages: ExtractedImage[] = [];
		let candidates: MetadataCandidate[] = [];
		let warnings: string[] = [];
		let query = '';

		if (mode === 'metadata') {
			let pdfMetadata: PaperMetadata = {};
			try {
				reportStatus(text.readPdfMetadata);
				pdfMetadata = await readPdfMetadata(this.app, file, signal);
				if (Object.keys(pdfMetadata).length) candidates.push({ source: 'PDF', metadata: pdfMetadata });
			} catch (error) {
				if (error instanceof ImportCancelledError) throw error;
				warnings.push(`PDF 元信息：${error instanceof Error ? error.message : '读取失败'}`);
			}
			const initialQuery = pdfMetadata.doi ?? pdfMetadata.arxivId ?? pdfMetadata.title ?? file.basename;
			const requestedQuery = await MetadataQueryModal.ask(this.app, initialQuery, signal);
			if (!requestedQuery) return null;
			query = requestedQuery;
		} else {
			reportStatus(text.readPdf);
			const parsed = await parsePdfWithMineru(this.app, file, settings, reportStatus, signal);
			parsedMarkdown = parsed.markdown;
			parsedImages = parsed.images;
			const parsedMetadata = extractMetadataFromMarkdown(parsed.markdown);
			candidates.push({ source: 'MinerU', metadata: parsedMetadata });
			if (mode === 'combined') {
				query = parsedMetadata.doi ?? parsedMetadata.arxivId ?? parsedMetadata.title ?? file.basename;
			}
		}

		checkCancelled(signal);
		if (mode !== 'parse') {
			if (!settings.crossrefEnabled && !settings.arxivEnabled) {
				warnings.push(text.metadataSourceDisabled);
			} else {
				reportStatus(text.queryMetadata);
				const parsedTitle = parsedMarkdown
					? extractMetadataFromMarkdown(parsedMarkdown).title
					: undefined;
				const lookup = await lookupMetadata(query, settings, parsedTitle, signal);
				candidates = [...candidates, ...lookup.candidates];
				warnings.push(...lookup.errors);
			}
		}

		if (mode === 'metadata' && candidates.length === 0) {
			const detail = warnings.length ? ` ${warnings.join(' ')}` : '';
			throw new Error(text.noMetadata(detail));
		}

		checkCancelled(signal);
		reportStatus(text.organizeMetadata);
		const resolution = candidates.length
			? await resolveMetadataCandidates(this.app, candidates, signal)
			: { metadata: {}, sources: {} } satisfies ResolvedMetadata;
		if (!resolution) return null;

		const title = resolution.metadata.title?.trim() || file.basename;
		const finalMetadata = { ...resolution.metadata, title };
		let rankings: JournalRankingMatch[] = [];
		if (settings.journalRankingEnabled && (finalMetadata.journal || finalMetadata.issn?.length)) {
			reportStatus(text.queryJournalRanking);
			try {
				rankings = await this.journalRankings.lookup(finalMetadata.journal, finalMetadata.issn);
			} catch (error) {
				warnings.push(text.journalRankingFailed(error instanceof Error ? error.message : text.unknownError));
			}
		}
		checkCancelled(signal);
		const notePath = await this.writeNote(
			file,
			parsedMarkdown,
			parsedImages,
			finalMetadata,
			resolution.sources,
			settings,
			mode === 'parse' ? [] : candidates,
			rankings,
			reportStatus,
			signal,
		);
		await this.app.workspace.openLinkText(notePath, '', true);
		return { notePath, warnings };
	}

	private async writeNote(
		file: TFile,
		parsedMarkdown: string | undefined,
		parsedImages: ExtractedImage[],
		metadata: PaperMetadata,
		sources: ResolvedMetadata['sources'],
		settings: PaperImporterSettings,
		candidates: MetadataCandidate[],
		rankings: JournalRankingMatch[],
		reportStatus: (message: string) => void,
		signal?: AbortSignal,
	): Promise<string> {
		checkCancelled(signal);
		const outputFolder = safeOutputFolder(settings.outputFolder);
		const paperPath = file.path.replace(/\\/g, '/').split('/').map((segment, index, parts) => {
			const name = index === parts.length - 1 ? segment.replace(/\.pdf$/i, '') : segment;
			return safeSegment(name);
		}).join('/');
		const paperFolder = normalizePath(`${outputFolder}/${paperPath}`);
		const noteName = `${safeSegment(file.basename)}.md`;
		const notePath = normalizePath(`${paperFolder}/${noteName}`);
		const renderedImages = parsedImages.map((image) => ({
			path: normalizePath(`${paperFolder}/${image.path}`),
			data: image.data,
		}));
		const imagePaths = renderedImages.map((item) => item.path);
		const abstractNote = this.app.vault.getAbstractFileByPath(notePath);
		const existingNote = abstractNote instanceof TFile ? abstractNote : undefined;
		const writes = [notePath, ...imagePaths];
		const existing: string[] = [];
		for (const path of writes) {
			checkCancelled(signal);
			if (await this.app.vault.adapter.exists(path)) existing.push(path);
		}
		if (existing.length && !(await OverwriteConfirmModal.confirm(this.app, existing, signal))) {
			throw new ImportCancelledError();
		}

		let existingBody: string | undefined;
		if (!parsedMarkdown && existingNote) {
			existingBody = extractNoteBody(await this.app.vault.read(existingNote));
		}
		checkCancelled(signal);
		reportStatus(uiStrings().writeOutput);
		await ensureFolder(this.app, paperFolder, signal);
		if (renderedImages.length) {
			await ensureFolder(this.app, `${paperFolder}/assets/images`, signal);
			for (const item of renderedImages) {
				checkCancelled(signal);
				const data = new Uint8Array(item.data).buffer;
				const abstractFile = this.app.vault.getAbstractFileByPath(item.path);
				if (abstractFile instanceof TFile) await this.app.vault.modifyBinary(abstractFile, data);
				else if (!abstractFile) await this.app.vault.createBinary(item.path, data);
				else throw new Error(`图片路径已被文件夹占用：${item.path}`);
			}
		}

		const body = parsedMarkdown?.trim()
			? appendSourcePdfLink(parsedMarkdown.trim(), file)
			: existingBody ?? metadataOnlyBody(metadata, file);
		const content = renderNote(metadata, sources, file, body, candidates, rankings);
		checkCancelled(signal);
		if (existingNote) await this.app.vault.modify(existingNote, content);
		else if (!abstractNote) await this.app.vault.create(notePath, content);
		else throw new Error(`笔记路径已被文件夹占用：${notePath}`);
		return notePath;
	}
}

function appendSourcePdfLink(markdown: string, file: TFile): string {
	if (markdown.includes(`[[${file.path}]]`)) return markdown;
	return `${markdown}\n\n## ${uiStrings().sourcePdfHeading}\n\n[[${file.path}]]`;
}

function safeOutputFolder(value: string): string {
	const segments = value.replace(/\\/g, '/').split('/').filter(Boolean);
	if (segments.some((segment) => segment === '.' || segment === '..')) {
		throw new Error('输出目录不能包含 . 或 .. 路径段。');
	}
	const path = normalizePath(segments.join('/'));
	if (!path) throw new Error('输出目录不能为空。');
	return path;
}

function safeSegment(value: string): string {
	const cleaned = value
		.replace(/[<>:"/\\|?*#^[\]]/g, '-')
		.replace(/\p{Cc}/gu, '')
		.replace(/\s+/g, ' ')
		.replace(/[. ]+$/g, '')
		.trim()
		.slice(0, 100);
	return cleaned || 'Untitled paper';
}

function extractNoteBody(content: string): string {
	if (!content.startsWith('---')) return content;
	const closingMarker = content.indexOf('\n---', 3);
	if (closingMarker < 0) return content;
	return content.slice(closingMarker + 4).replace(/^\n+/, '');
}

async function ensureFolder(app: App, path: string, signal?: AbortSignal): Promise<void> {
	const segments = normalizePath(path).split('/');
	let current = '';
	for (const segment of segments) {
		checkCancelled(signal);
		current = current ? `${current}/${segment}` : segment;
		if (!(await app.vault.adapter.exists(current))) await app.vault.createFolder(current);
	}
}
