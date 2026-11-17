import { App, TFile } from 'obsidian';
import { strFromU8, unzipSync } from 'fflate';
import { PaperImporterSettings, MineruParseResult, ExtractedImage } from '../types';
import { httpRequest } from './http';
import { checkCancelled, delay } from '../utils/tasks';

type MineruEnvelope<T> = {
	code?: number;
	msg?: string;
	data?: T;
};

type BatchSubmission = {
	batch_id?: string;
	file_urls?: string[];
};

type ExtractResult = {
	data_id?: string;
	file_name?: string;
	state?: string;
	full_zip_url?: string;
	err_msg?: string;
};

type BatchStatus = {
	extract_result?: ExtractResult | ExtractResult[];
};

function endpoint(settings: PaperImporterSettings, path: string): string {
	const base = settings.mineruEndpoint.trim().replace(/\/+$/, '');
	return `${base}/${path.replace(/^\/+/, '')}`;
}

async function mineruJson<T>(
	url: string,
	token: string,
	method: 'GET' | 'POST',
	body?: unknown,
	signal?: AbortSignal,
	timeoutMs = 60_000,
): Promise<T> {
	checkCancelled(signal);
	const response = await httpRequest({
		url,
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	}, signal, timeoutMs);

	let payload: MineruEnvelope<T>;
	try {
		payload = response.json as MineruEnvelope<T>;
	} catch {
		throw new Error('MinerU returned an invalid response.');
	}
	if (payload.code !== 0 || payload.data === undefined) {
		throw new Error(payload.msg || 'MinerU rejected the request. Check the API token and settings.');
	}
	return payload.data;
}

export async function parsePdfWithMineru(
	app: App,
	file: TFile,
	settings: PaperImporterSettings,
	reportStatus: (message: string) => void,
	signal?: AbortSignal,
): Promise<MineruParseResult> {
	checkCancelled(signal);
	if (!settings.mineruToken.trim()) {
		throw new Error('Set a MinerU API token in the plugin settings first.');
	}

	reportStatus('Reading PDF from the vault…');
	const pdfData = await app.vault.readBinary(file);
	if (pdfData.byteLength > 200 * 1024 * 1024) {
		throw new Error('MinerU accepts files up to 200 MB.');
	}

	const dataId = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	reportStatus('Requesting a secure upload URL from MinerU…');
	const timeoutMs = Math.max(1, settings.requestTimeoutSeconds) * 1000;
	const submission = await mineruJson<BatchSubmission>(
		endpoint(settings, 'file-urls/batch'),
		settings.mineruToken.trim(),
		'POST',
		{
			files: [{ name: file.name, data_id: dataId, is_ocr: settings.enableOcr }],
			model_version: settings.mineruModel,
			language: settings.language,
			enable_formula: settings.enableFormula,
			enable_table: settings.enableTable,
		},
		signal,
		timeoutMs,
	);
	const batchId = submission.batch_id;
	const uploadUrl = submission.file_urls?.[0];
	if (!batchId || !uploadUrl) {
		throw new Error('MinerU did not return an upload URL.');
	}

	reportStatus('Uploading the PDF to MinerU for parsing…');
	await httpRequest({
		url: uploadUrl,
		method: 'PUT',
		body: pdfData,
	}, signal, timeoutMs);

	const deadline = Date.now() + Math.max(1, settings.taskTimeoutMinutes) * 60 * 1000;
	let result: ExtractResult | undefined;
	while (Date.now() < deadline) {
		const status = await mineruJson<BatchStatus>(
			endpoint(settings, `extract-results/batch/${encodeURIComponent(batchId)}`),
			settings.mineruToken.trim(),
			'GET',
			undefined,
			signal,
			timeoutMs,
		);
		const entries = Array.isArray(status.extract_result)
			? status.extract_result
			: status.extract_result
				? [status.extract_result]
				: [];
		result = entries.find((entry) => entry.data_id === dataId) ?? entries[0];

		if (result?.state === 'done' && result.full_zip_url) break;
		if (result?.state === 'failed') {
			throw new Error(result.err_msg || 'MinerU could not parse this PDF.');
		}
		const progress = result?.state ? ` (${result.state})` : '';
		reportStatus(`Waiting for MinerU to finish parsing${progress}…`);
		await delay(Math.max(1, settings.pollIntervalSeconds) * 1000, signal);
	}

	if (result?.state !== 'done' || !result.full_zip_url) {
		throw new Error(`MinerU parsing timed out after ${settings.taskTimeoutMinutes} minutes.`);
	}

	reportStatus('Downloading and unpacking the parsed Markdown…');
	checkCancelled(signal);
	const archiveResponse = await httpRequest({ url: result.full_zip_url }, signal, timeoutMs);
	const archive = unzipSync(new Uint8Array(archiveResponse.arrayBuffer));
	const entries = Object.entries(archive).filter(([path]) => !path.endsWith('/'));
	const markdownEntry = entries.find(([path]) => /(^|\/)full\.md$/i.test(path))
		?? entries.find(([path]) => path.toLowerCase().endsWith('.md'));
	if (!markdownEntry) {
		throw new Error('The MinerU result archive does not contain a Markdown file.');
	}

	const images = collectImages(entries);
	const markdown = rewriteImageLinks(strFromU8(markdownEntry[1]), images);
	return { markdown, images };
}

function collectImages(entries: [string, Uint8Array][]): ExtractedImage[] {
	const usedNames = new Map<string, number>();
	const images: ExtractedImage[] = [];
	for (const [entryPath, data] of entries) {
		if (!/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(entryPath)) continue;
		const sourcePath = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
		const basename = sourcePath.split('/').pop() ?? 'image.png';
		const extensionIndex = basename.lastIndexOf('.');
		const extension = extensionIndex >= 0 ? basename.slice(extensionIndex) : '.png';
		const stem = (extensionIndex >= 0 ? basename.slice(0, extensionIndex) : basename)
			.replace(/[^\p{L}\p{N}._-]+/gu, '_')
			.replace(/^\.+/, '') || 'image';
		const safeBasename = `${stem}${extension}`;
		const count = (usedNames.get(safeBasename.toLowerCase()) ?? 0) + 1;
		usedNames.set(safeBasename.toLowerCase(), count);
		const filename = count === 1
			? safeBasename
			: `${stem}-${count}${extension}`;
		images.push({
			path: `assets/images/${filename}`,
			sourcePath,
			data: new Uint8Array(data),
		});
	}
	return images;
}

function rewriteImageLinks(markdown: string, images: ExtractedImage[]): string {
	const basenameCounts = new Map<string, ExtractedImage[]>();
	for (const image of images) {
		const basename = image.sourcePath.split('/').pop()?.toLowerCase() ?? '';
		const list = basenameCounts.get(basename) ?? [];
		list.push(image);
		basenameCounts.set(basename, list);
	}

	const replacementFor = (rawPath: string): string => {
		const path = rawPath.trim().replace(/^<|>$/g, '');
		if (/^(?:https?:|data:|#)/i.test(path)) return rawPath;
		let decoded = path.split(/[?#]/, 1)[0] ?? path;
		try {
			decoded = decodeURIComponent(decoded);
		} catch {
			// Keep the original path when it contains malformed URI escapes.
		}
		decoded = decoded.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
		const exactMatch = images.find((image) => {
			const sourcePath = image.sourcePath.toLowerCase();
			const reference = decoded.toLowerCase();
			return reference === sourcePath || reference.endsWith(`/${sourcePath}`);
		});
		if (exactMatch) return exactMatch.path;
		const basename = decoded.split('/').pop()?.toLowerCase() ?? '';
		const match = basenameCounts.get(basename);
		if (!match || match.length !== 1) return rawPath;
		return match[0]?.path ?? rawPath;
	};

	return markdown
		.replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (_match, before: string, path: string, after: string) =>
			`${before}${replacementFor(path)}${after}`,
		)
		.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (_match, before: string, path: string, after: string) =>
			`${before}${replacementFor(path)}${after}`,
		);
}
