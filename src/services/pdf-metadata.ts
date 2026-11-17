import { App, loadPdfJs, TFile } from 'obsidian';
import { PaperMetadata } from '../types';
import { checkCancelled } from '../utils/tasks';
import { findArxivId, findDoi } from './metadata';

interface PdfPage {
	getTextContent(): Promise<{ items: unknown[] }>;
	cleanup(): void;
}
interface PdfDocument {
	numPages: number;
	getMetadata(): Promise<{ info: unknown }>;
	getPage(page: number): Promise<PdfPage>;
}
interface PdfTask { promise: Promise<PdfDocument>; destroy(): Promise<void> }
interface PdfLibrary {
	getDocument(options: { data: Uint8Array; isEvalSupported: boolean; disableFontFace: boolean }): PdfTask;
}

export async function readPdfMetadata(app: App, file: TFile, signal?: AbortSignal): Promise<PaperMetadata> {
	checkCancelled(signal);
	const library: unknown = await loadPdfJs();
	if (!isPdfLibrary(library)) throw new Error('PDF 文本读取组件不可用，可手动输入查询。');
	const bytes = await app.vault.readBinary(file);
	checkCancelled(signal);
	const task = library.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true });
	try {
		const document = await task.promise;
		checkCancelled(signal);
		const { info } = await document.getMetadata();
		const sections: string[] = [];
		for (let number = 1; number <= Math.min(2, document.numPages); number++) {
			checkCancelled(signal);
			const page = await document.getPage(number);
			try {
				const content = await page.getTextContent();
				sections.push(content.items.map((item) => {
					if (!isRecord(item) || typeof item.str !== 'string') return '';
					return item.str + (item.hasEOL ? '\n' : ' ');
				}).join(''));
			} finally { page.cleanup(); }
		}
		const text = sections.join('\n');
		const title = isRecord(info) && typeof info.Title === 'string' ? info.Title.trim() : '';
		const author = isRecord(info) && typeof info.Author === 'string' ? info.Author.trim() : '';
		const result: PaperMetadata = {};
		if (title && !/^(untitled|microsoft (word|powerpoint)|latex|arxiv)/i.test(title)) result.title = title;
		if (author) result.authors = author.split(';').map((name) => name.trim()).filter(Boolean);
		const doi = findDoi(text);
		const arxivId = findArxivId(text);
		if (doi) result.doi = doi;
		if (arxivId) result.arxivId = arxivId;
		return result;
	} finally {
		await task.destroy();
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
function isPdfLibrary(value: unknown): value is PdfLibrary {
	// The loaded object is Obsidian's bundled PDF.js; its public getDocument API owns the task shape.
	return isRecord(value) && typeof value.getDocument === 'function';
}
