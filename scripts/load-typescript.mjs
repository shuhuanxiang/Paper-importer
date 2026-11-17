import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Execute the same TypeScript modules used by the plugin, without keeping generated bundles. */
export async function loadTypeScript(options) {
	const compiled = await build({
		...options, bundle: true, write: false, format: 'esm', platform: 'node', target: 'node18',
	});
	const directory = await mkdtemp(join(tmpdir(), 'paper-importer-'));
	try {
		const path = join(directory, 'module.mjs');
		await writeFile(path, compiled.outputFiles[0].text);
		return await import(pathToFileURL(path).href);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
