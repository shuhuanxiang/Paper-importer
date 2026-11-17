import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import { loadTypeScript } from '../scripts/load-typescript.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const api = await loadTypeScript({
	stdin: {
		resolveDir: projectRoot,
		contents: `
			export * from './src/journal/csv';
			export * from './src/journal/library';
			export * from './src/journal/index';
			export * from './src/journal/service';
			export * from './src/services/metadata';
			export * from './src/note';
		`,
	},
	plugins: [{
		name: 'obsidian-test-stub',
		setup(build) {
			build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
			build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
				contents: `
					export const getLanguage = () => 'en';
					export const normalizePath = value => value.replaceAll('\\\\', '/');
					export const requestUrl = async () => ({
						status: 200,
						text: JSON.stringify({ message: {
							title: ['Example paper'], 'container-title': ['Journal of the ACM'],
							ISSN: ['0004-5411'], DOI: '10.1234/example',
							abstract: { deliberately: 'ignored even if not a string' }
						} })
					});
				`,
			}));
		},
	}],
});
const bytes = text => new TextEncoder().encode(text);
const csv = (name, text) => api.parseJournalCsv(name, bytes(text));
const source = (system, year, entries, name = system + year + '.csv') => ({ system, year, entries, name });
const entry = (name, rank, issns = [], aliases = []) => ({ names: [name, ...aliases], rank, issns });
const library = (...sources) => ({ version: 1, sources });
const file = (name, data) => ({
	name, arrayBuffer: async () => Uint8Array.from(typeof data === 'string' ? bytes(data) : data).buffer,
});
function adapter() {
	const files = new Map();
	let writes = 0;
	return {
		files,
		get writes() { return writes; },
		exists: async path => files.has(path),
		readBinary: async path => Uint8Array.from(files.get(path)).buffer,
		writeBinary: async (path, data) => { writes++; files.set(path, new Uint8Array(data)); },
	};
}

test('CSV handles BOM, commas, escaped quotes and quoted newlines, rejecting malformed input', () => {
	assert.deepEqual(api.parseCsv('\uFEFFJournal,Note\r\n"A, B","a ""quote""\nand line"\r\n'), [
		['Journal', 'Note'], ['A, B', 'a "quote"\nand line'],
	]);
	assert.throws(() => api.parseCsv('Journal\n"Unfinished'), /unterminated/);
	assert.throws(() => api.parseCsv('"Journal"x'), /unexpected/);
	assert.throws(() => csv('CCF2026.csv', 'Journal,年份,CCF推荐类型\nA,2026,A类,extra'), /column count/);
});

test('GB18030 detection and missing English names retain Chinese and acronym entries', () => {
	const encoded = Buffer.from('4a6f75726e616c2cc4eab7dd2c434346cdc6bcf6c0e0d0cd0a4578616d706c652c323032362c41c0e0', 'hex');
	assert.equal(api.parseJournalCsv('CCF.csv', encoded).sources[0].entries[0].rank, 'A');
	const chinese = csv('CCFT2025.csv', 'Journal,中文刊名,T分区\n,计算机学报,T1');
	assert.equal(chinese.sources[0].entries[0].names[0], '计算机学报');
	const conference = csv('CCF2026.csv', 'Journal,刊物名称,CCF推荐类型\n,HotSec,C类');
	assert.equal(conference.sources[0].entries[0].names[0], 'HotSec');
});

test('JCR takes the best valid category and CAS uses the major partition', () => {
	const jcr = csv('JCR2025.csv', 'Journal,ISSN,EISSN,IF Quartile(2025)_1,IF Quartile(2025)_2\nExample,1234-567X,8765-4321,Q3,Q1\nUnranked,,,N/A,N/A');
	assert.equal(jcr.sources[0].entries.length, 1);
	assert.equal(jcr.sources[0].entries[0].rank, 'Q1');
	assert.deepEqual(jcr.sources[0].entries[0].issns, ['1234567X', '87654321']);
	const cas = csv('CAS2025.csv', 'Journal,大类分区,小类1分区,Top\nExample,2 [100/500],1 [1/100],是');
	assert.deepEqual(cas.sources[0].entries[0], { names: ['Example'], issns: [], rank: '2区', top: true });
});

test('ISSN overrides a conflicting name and bridges exact aliases into tables without ISSNs', () => {
	const index = new api.JournalRankingIndex(library(
		source('JCR', 2025, [entry('Correct Journal', 'Q1', ['1234567X']), entry('Wrong Journal', 'Q4', ['87654321'])]),
		source('CCF', 2026, [entry('Correct Journal', 'A'), entry('Wrong Journal', 'C')]),
	));
	const matches = index.lookup('Wrong Journal', ['1234-567X']);
	assert.deepEqual(matches.map(match => [match.system, match.rank]), [['CCF', 'A'], ['JCR', 'Q1']]);
	assert.equal(index.lookup('WRONG JOURNAL', ['9999-9999']).some(match => match.system === 'JCR'), false);
	assert.deepEqual(index.lookup('Correc'), []);
	assert.deepEqual(index.lookup(), []);
});

test('names normalize case, punctuation, accents and &, while ambiguous acronyms are skipped', () => {
	assert.equal(api.normalizeJournalName('Journál of A & B'), api.normalizeJournalName('JOURNAL OF A AND B'));
	const index = new api.JournalRankingIndex(library(source('CCF', 2026, [
		entry('First Journal', 'A', [], ['ABC']), entry('Second Journal', 'B', [], ['ABC']),
	])));
	assert.deepEqual(index.lookup('ABC'), []);
	assert.equal(index.lookup('FIRST-JOURNAL')[0].rank, 'A');
});

test('each ranking system uses its newest year and keeps year-specific historical warnings', () => {
	const index = new api.JournalRankingIndex(library(
		source('JCR', 2024, [entry('Example', 'Q1')]),
		source('JCR', 2025, [entry('Example', 'Q2')]),
		source('Warning', 2020, [entry('Example', '低')]),
		source('Warning', 2025, [{ ...entry('Example', '预警'), note: '论文工厂' }]),
	));
	const matches = index.lookup('Example');
	assert.deepEqual(matches.filter(match => match.system === 'JCR').map(match => [match.year, match.rank]), [[2025, 'Q2']]);
	assert.deepEqual(matches.filter(match => match.system === 'Warning').map(match => match.year), [2025, 2020]);
	assert.ok(api.journalRankTags(matches).includes('journal/Warning-2020/低'));
	assert.equal(matches.find(match => match.year === 2025 && match.system === 'Warning').note, '论文工厂');
});

test('versioned JSON rejects malformed ranks and ISSNs and reimport replaces the same source', () => {
	const original = library(source('CCF', 2026, [entry('Example', 'A')]));
	assert.deepEqual(api.parseJournalLibrary(JSON.stringify(original)), original);
	assert.throws(() => api.parseJournalLibrary('{"version":2,"sources":[]}'), /format/);
	assert.throws(() => api.parseJournalLibrary(JSON.stringify(library(source('CCF', 2026, [entry('Example', 'Q1')])))), /ranking/);
	assert.throws(() => api.parseJournalLibrary(JSON.stringify(library(source('JCR', 2025, [entry('Example', 'Q1', ['invalid'])])))), /ISSN/);
	const updated = library(source('CCF', 2026, [entry('Example', 'B')]));
	assert.equal(api.mergeJournalLibraries(original, updated).sources.length, 1);
	assert.equal(api.mergeJournalLibraries(original, updated).sources[0].entries[0].rank, 'B');
});

test('service persists compressed libraries, reloads them and refreshes a cached index on import', async () => {
	const storage = adapter();
	const service = new api.JournalRankingService(storage, '.obsidian/plugins/paper-importer');
	assert.deepEqual(await service.summary(), { sources: 0, entries: 0 });
	assert.deepEqual(await service.lookup('Example'), []);
	await service.importFiles([file('CCF2026.csv', 'Journal,年份,CCF推荐类型\nExample,2026,A类')]);
	assert.equal((await service.lookup('Example'))[0].rank, 'A');
	await service.importFiles([file('CCF2026.csv', 'Journal,年份,CCF推荐类型\nExample,2026,B类')]);
	assert.equal((await service.lookup('Example'))[0].rank, 'B');
	assert.equal((await service.summary()).sources, 1);
	const stored = [...storage.files.values()][0];
	assert.equal(stored[0], 0x1f);
	assert.equal(JSON.parse(gunzipSync(stored)).sources[0].entries[0].rank, 'B');
	const reloaded = new api.JournalRankingService(storage, '.obsidian/plugins/paper-importer');
	assert.equal((await reloaded.lookup('Example'))[0].rank, 'B');
	const extra = library(source('JCR', 2025, [entry('Example', 'Q2')]));
	await reloaded.importFiles([file('rankings.json.gz', gzipSync(JSON.stringify(extra)))]);
	assert.deepEqual(await reloaded.summary(), { sources: 2, entries: 2 });
});

test('an invalid file in a selected batch leaves the installed library and cached grades intact', async () => {
	const storage = adapter();
	const service = new api.JournalRankingService(storage, '.obsidian/plugins/paper-importer');
	await service.importFiles([file('CCF2026.csv', 'Journal,年份,CCF推荐类型\nExample,2026,A类')]);
	await assert.rejects(service.importFiles([
		file('CCF2026.csv', 'Journal,年份,CCF推荐类型\nExample,2026,C类'),
		file('bad.json', '{"version":9}'),
	]), /bad.json/);
	assert.equal(storage.writes, 1);
	assert.equal((await service.lookup('Example'))[0].rank, 'A');
});

test('Crossref and Markdown metadata omit abstracts; notes contain rank properties and Obsidian tags', async () => {
	globalThis.window = globalThis;
	try {
		const lookup = await api.lookupMetadata('10.1234/example', { crossrefEnabled: true, arxivEnabled: false, crossrefEmail: '', requestTimeoutSeconds: 5 });
		assert.deepEqual(lookup.errors, []);
		const metadata = lookup.candidates[0].metadata;
		assert.deepEqual(metadata.issn, ['0004-5411']);
		assert.equal('abstract' in metadata, false);
		assert.equal('abstract' in api.extractMetadataFromMarkdown('# Example\n\n## Abstract\nSecret summary\n'), false);
		const pdf = { path: 'Papers/Example.pdf', basename: 'Example' };
		const rankings = [{ system: 'CAS', year: 2025, rank: '1区', top: true, source: 'CAS2025.csv' }];
		const note = api.renderNote(metadata, { journal: 'Crossref', issn: 'Crossref' }, pdf, api.metadataOnlyBody(metadata, pdf), lookup.candidates, rankings);
		assert.match(note, /journal_rank:\n  - "中科院 2025 1区 Top"/);
		assert.match(note, /"journal\/CAS-2025\/1区"/);
		assert.match(note, /"journal\/CAS-2025\/Top"/);
		assert.match(note, /journal_rank_sources:\n  - "CAS2025.csv"/);
		assert.match(note, /\[\[Papers\/Example.pdf\]\]/);
		assert.doesNotMatch(note, /abstract:|## Abstract|Secret summary/);
	} finally {
		delete globalThis.window;
	}
});

test('all supplied CSV formats convert to a validated library and match real journals and conferences', async () => {
	const files = (await readdir(projectRoot)).filter(name => /\.csv$/i.test(name)).sort();
	assert.equal(files.length, 11);
	const libraries = [];
	for (const name of files) libraries.push(api.parseJournalCsv(name, await readFile(new URL('../' + name, import.meta.url))));
	const merged = api.mergeJournalLibraries(...libraries);
	const restored = api.parseJournalLibrary(JSON.stringify(merged));
	assert.equal(restored.sources.length, 11);
	assert.equal(restored.sources.reduce((count, source) => count + source.entries.length, 0), 65329);
	const index = new api.JournalRankingIndex(restored);
	const jacm = index.lookup('Journal of the ACM', ['0004-5411']);
	assert.ok(jacm.some(match => match.system === 'CCF' && match.rank === 'A'));
	assert.ok(jacm.some(match => match.system === 'JCR'));
	assert.ok(index.lookup('计算机学报').some(match => match.system === 'CCF-T' && match.rank === 'T1'));
	assert.ok(index.lookup('CVPR').some(match => match.system === 'XR-conference' && match.rank === '1区'));
	assert.ok(index.lookup('Metals').some(match => match.system === 'Warning' && match.year === 2020));
});
