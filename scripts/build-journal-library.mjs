import { loadTypeScript } from './load-typescript.mjs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const inputDirectory = resolve(process.argv[2] ?? projectRoot);
const outputPath = resolve(process.argv[3] ?? resolve(projectRoot, 'dist/journal-rankings.json.gz'));
const { parseJournalCsv, mergeJournalLibraries, parseJournalLibrary } = await loadTypeScript({
	entryPoints: [resolve(projectRoot, 'src/journal/library.ts')],
});
const files = (await readdir(inputDirectory)).filter((name) => /\.csv$/i.test(name)).sort();
if (!files.length) throw new Error('No CSV files found in ' + inputDirectory);
const libraries = [];
for (const name of files) {
	const library = parseJournalCsv(name, await readFile(resolve(inputDirectory, name)));
	libraries.push(library);
	const entries = library.sources.reduce((count, source) => count + source.entries.length, 0);
	console.log(`${name}: ${entries.toLocaleString()} ranking records`);
}
const library = mergeJournalLibraries(...libraries);
const json = JSON.stringify(library);
parseJournalLibrary(json);
const compressed = gzipSync(json, { level: 9 });
await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, compressed);
const entries = library.sources.reduce((count, source) => count + source.entries.length, 0);
console.log(`Saved ${library.sources.length} tables / ${entries.toLocaleString()} records / ${compressed.length.toLocaleString()} bytes to ${outputPath}`);
