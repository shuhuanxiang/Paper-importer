import { DataAdapter, normalizePath } from 'obsidian';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { JournalRankingIndex } from './index';
import { mergeJournalLibraries, parseJournalCsv, parseJournalLibrary } from './library';
import { JournalLibrary, JournalLibrarySummary, JournalRankingMatch } from './types';

export interface JournalImportFile {
	name: string;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export class JournalRankingService {
	private readonly path: string;
	private library: Promise<JournalLibrary> | undefined;
	private index: JournalRankingIndex | undefined;
	private importing = false;

	constructor(private readonly adapter: DataAdapter, pluginDirectory: string) {
		this.path = normalizePath(`${pluginDirectory}/journal-rankings.json.gz`);
	}

	async lookup(journal?: string, issns?: string[]): Promise<JournalRankingMatch[]> {
		if (!journal && !issns?.length) return [];
		if (!this.index) this.index = new JournalRankingIndex(await this.load());
		return this.index.lookup(journal, issns);
	}

	async summary(): Promise<JournalLibrarySummary> {
		const library = await this.load();
		return {
			sources: library.sources.length,
			entries: library.sources.reduce((count, source) => count + source.entries.length, 0),
		};
	}

	async importFiles(files: JournalImportFile[]): Promise<JournalLibrarySummary> {
		if (this.importing) throw new Error('A journal library import is already running.');
		this.importing = true;
		try {
			const imported: JournalLibrary[] = [];
			for (const file of files) {
				try {
					let bytes = new Uint8Array(await file.arrayBuffer());
					if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
					const name = file.name.replace(/\.gz$/i, '');
					imported.push(/\.csv$/i.test(name)
						? parseJournalCsv(name, bytes)
						: parseJournalLibrary(strFromU8(bytes)));
				} catch (error) {
					throw new Error(`${file.name}: ${error instanceof Error ? error.message : 'Invalid journal library.'}`);
				}
			}
			if (!imported.length) return await this.summary();
			// Validate every selected file before changing the installed library.
			const library = mergeJournalLibraries(await this.load(), ...imported);
			const compressed = gzipSync(strToU8(JSON.stringify(library)));
			await this.adapter.writeBinary(this.path, new Uint8Array(compressed).buffer);
			this.library = Promise.resolve(library);
			this.index = undefined;
			return await this.summary();
		} finally {
			this.importing = false;
		}
	}

	private async load(): Promise<JournalLibrary> {
		if (!this.library) {
			this.library = this.read().catch((error: unknown) => {
				this.library = undefined;
				throw error;
			});
		}
		return this.library;
	}

	private async read(): Promise<JournalLibrary> {
		if (!(await this.adapter.exists(this.path))) return { version: 1, sources: [] };
		const data = new Uint8Array(await this.adapter.readBinary(this.path));
		return parseJournalLibrary(strFromU8(gunzipSync(data)));
	}
}
