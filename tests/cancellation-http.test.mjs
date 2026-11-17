import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadTypeScript } from '../scripts/load-typescript.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const api = await loadTypeScript({
	stdin: {
		resolveDir: projectRoot,
		contents: `
			export * from './src/ui/modals';
			export * from './src/services/http';
			export * from './src/services/metadata-resolver';
			export * from './src/importer';
			export { TFile } from 'obsidian';
		`,
	},
	plugins: [{
		name: 'obsidian-workflow-test-stub',
		setup(build) {
			build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
			build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
				contents: `
					export const getLanguage = () => 'en';
					export const normalizePath = path => path.replaceAll('\\\\', '/');
					export const requestUrl = (...args) => globalThis.__paperImporterRequestUrl(...args);
					export class TFile {
						constructor(path) { this.path = path; this.name = path.split('/').pop(); this.basename = this.name.replace(/\\.[^.]+$/, ''); this.extension = this.name.split('.').pop(); }
					}
					export const loadPdfJs = async () => ({ getDocument: () => ({
						promise: Promise.resolve({ numPages: 0, getMetadata: async () => ({ info: { Title: 'Local title' } }) }),
						destroy: async () => {},
					}) });
					export class Modal {
						constructor() { this.contentEl = { empty() {} }; this.titleEl = { setText() {} }; }
						open() { this.opened = true; globalThis.__paperImporterModals.push(this); }
						close() { this.closed = true; this.onClose(); }
					}
					export class Setting {}
				`,
			}));
		},
	}],
});

function startModalTest() {
	globalThis.__paperImporterModals = [];
}

function successfulResponse() {
	return { status: 200, text: 'ok' };
}

async function withNetworkClock(run, onBackoff) {
	const oldWindow = globalThis.window;
	const oldRequest = globalThis.__paperImporterRequestUrl;
	const timers = new Set();
	globalThis.window = {
		setTimeout(callback, milliseconds) {
			const handle = setTimeout(() => {
				timers.delete(handle);
				callback();
			}, milliseconds >= 1000 ? 0 : milliseconds);
			timers.add(handle);
			if (milliseconds >= 1000 && onBackoff) queueMicrotask(onBackoff);
			return handle;
		},
		clearTimeout(handle) {
			timers.delete(handle);
			clearTimeout(handle);
		},
	};
	try {
		await run();
		assert.equal(timers.size, 0, 'request and retry timers must be cleared');
	} finally {
		for (const handle of timers) clearTimeout(handle);
		globalThis.window = oldWindow;
		globalThis.__paperImporterRequestUrl = oldRequest;
	}
}

test('metadata conflict modal closes and settles when the import is aborted', async () => {
	startModalTest();
	const controller = new AbortController();
	const pending = api.MetadataConflictModal.resolve({}, ['title'], [
		{ source: 'PDF', metadata: { title: 'A' } },
		{ source: 'Crossref', metadata: { title: 'B' } },
	], controller.signal);
	const modal = globalThis.__paperImporterModals[0];
	assert.equal(modal.opened, true);
	controller.abort();
	assert.equal(await pending, null);
	assert.equal(modal.closed, true);
	assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('overwrite confirmation returns false immediately for active and pre-aborted signals', async () => {
	startModalTest();
	const controller = new AbortController();
	const pending = api.OverwriteConfirmModal.confirm({}, ['Papers/Example.md'], controller.signal);
	const modal = globalThis.__paperImporterModals[0];
	controller.abort();
	assert.equal(await pending, false);
	assert.equal(modal.closed, true);

	const alreadyAborted = new AbortController();
	alreadyAborted.abort();
	assert.equal(await api.OverwriteConfirmModal.confirm({}, ['Papers/Example.md'], alreadyAborted.signal), false);
	assert.equal(globalThis.__paperImporterModals.length, 1);
});

test('metadata query modal rejects and closes when the import is aborted', async () => {
	startModalTest();
	const controller = new AbortController();
	const pending = api.MetadataQueryModal.ask({}, 'Example', controller.signal);
	const modal = globalThis.__paperImporterModals[0];
	controller.abort();
	await assert.rejects(pending, error => error.name === 'ImportCancelledError');
	assert.equal(modal.closed, true);
});

test('GET retries transient transport failures and succeeds on a later attempt', async () => {
	await withNetworkClock(async () => {
		let attempts = 0;
		globalThis.__paperImporterRequestUrl = async () => {
			attempts++;
			if (attempts === 1) throw new Error('connection reset');
			return successfulResponse();
		};
		const result = await api.httpRequest({ url: 'https://service.example/api' }, undefined, 50);
		assert.equal(result.status, 200);
		assert.equal(attempts, 2);
	});
});

test('GET retries request timeouts but stops after the configured attempt limit', async () => {
	await withNetworkClock(async () => {
		let attempts = 0;
		globalThis.__paperImporterRequestUrl = () => {
			attempts++;
			return new Promise(() => {});
		};
		await assert.rejects(
			api.httpRequest({ url: 'https://service.example/api' }, undefined, 5),
			/超时/,
		);
		assert.equal(attempts, 3);
	});
});

test('GET retries 429 and 5xx, does not retry ordinary 4xx, and POST is never retried', async () => {
	await withNetworkClock(async () => {
		let attempts = 0;
		globalThis.__paperImporterRequestUrl = async () => {
			attempts++;
			if (attempts === 1) return { status: 429, text: '' };
			return attempts === 2 ? { status: 503, text: '' } : successfulResponse();
		};
		assert.equal((await api.httpRequest({ url: 'https://service.example/api' }, undefined, 50)).status, 200);
		assert.equal(attempts, 3);

		attempts = 0;
		globalThis.__paperImporterRequestUrl = async () => {
			attempts++;
			return { status: 404, text: '' };
		};
		await assert.rejects(api.httpRequest({ url: 'https://service.example/api' }, undefined, 50), /HTTP 404/);
		assert.equal(attempts, 1);

		attempts = 0;
		globalThis.__paperImporterRequestUrl = async () => {
			attempts++;
			throw new Error('connection reset');
		};
		await assert.rejects(
			api.httpRequest({ url: 'https://service.example/api', method: 'POST' }, undefined, 50),
			/网络请求失败/,
		);
		assert.equal(attempts, 1);
	});
});

test('pre-aborted conflict resolution opens no modal', async () => {
	startModalTest();
	const controller = new AbortController();
	controller.abort();
	assert.equal(await api.MetadataConflictModal.resolve({}, ['title'], [], controller.signal), null);
	assert.equal(globalThis.__paperImporterModals.length, 0);
	assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('confirming or dismissing a modal removes its abort listener', async () => {
	startModalTest();
	const controller = new AbortController();
	const pending = api.OverwriteConfirmModal.confirm({}, ['Example.md'], controller.signal);
	const modal = globalThis.__paperImporterModals[0];
	assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
	modal.onSubmit(true);
	assert.equal(await pending, true);
	assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
	controller.abort();
	assert.notEqual(modal.closed, true, 'a settled dialog must no longer react to cancellation');
	modal.close();

	const dismissal = new AbortController();
	const cancelled = api.MetadataConflictModal.resolve({}, [], [], dismissal.signal);
	globalThis.__paperImporterModals[1].close();
	assert.equal(await cancelled, null);
	assert.equal(getEventListeners(dismissal.signal, 'abort').length, 0);
});

test('GET retries synchronous transport failures and limits repeated failures to three attempts', async () => {
	await withNetworkClock(async () => {
		let attempts = 0;
		globalThis.__paperImporterRequestUrl = () => {
			attempts++;
			throw new Error('connection reset');
		};
		await assert.rejects(api.httpRequest({ url: 'https://service.example/api' }, undefined, 50), /网络请求失败/);
		assert.equal(attempts, 3);
	});
});

test('aborting an in-flight GET discards its late response without retrying', async () => {
	await withNetworkClock(async () => {
		let attempts = 0;
		let respond;
		const controller = new AbortController();
		globalThis.__paperImporterRequestUrl = () => {
			attempts++;
			return new Promise(resolve => { respond = resolve; });
		};
		const pending = api.httpRequest({ url: 'https://service.example/api' }, controller.signal, 50);
		controller.abort();
		await assert.rejects(pending, error => error.name === 'ImportCancelledError');
		respond(successfulResponse());
		await Promise.resolve();
		assert.equal(attempts, 1);
		assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
	});
});

test('aborting during GET retry backoff prevents the next request', async () => {
	const controller = new AbortController();
	await withNetworkClock(async () => {
		let attempts = 0;
		globalThis.__paperImporterRequestUrl = async () => {
			attempts++;
			throw new Error('connection reset');
		};
		await assert.rejects(
			api.httpRequest({ url: 'https://service.example/api' }, controller.signal, 50),
			error => error.name === 'ImportCancelledError',
		);
		assert.equal(attempts, 1);
		assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
	}, () => controller.abort());
});

function importFixture(existingNote = false, crossrefEnabled = false) {
	const writes = [];
	const notePath = 'MinerU/Papers/Example/Example.md';
	const note = existingNote ? new api.TFile(notePath) : null;
	const app = {
		vault: {
			adapter: { exists: async path => path === notePath && existingNote },
			getAbstractFileByPath: path => path === notePath ? note : null,
			readBinary: async () => new ArrayBuffer(0),
			read: async () => 'Existing note body',
			createFolder: async path => { writes.push(path); },
			create: async path => { writes.push(path); },
			modify: async file => { writes.push(file.path); },
		},
		workspace: { openLinkText: async path => { throw new Error('Unexpected open: ' + path); } },
	};
	const settings = { outputFolder: 'MinerU', crossrefEnabled, arxivEnabled: false, crossrefEmail: '', requestTimeoutSeconds: 1 };
	return { writes, service: new api.PaperImportService(app, () => settings, {}) };
}

async function waitForModal(type) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const modal = globalThis.__paperImporterModals.find(item => item instanceof type);
		if (modal) return modal;
		await Promise.resolve();
	}
	throw new Error('Expected modal did not open: ' + type.name);
}

for (const stage of ['conflict', 'overwrite']) {
	test('cancelling at the ' + stage + ' stage stops the import without any vault writes', { timeout: 2000 }, async () => {
		await withNetworkClock(async () => {
			startModalTest();
			const { service, writes } = importFixture(stage === 'overwrite', stage === 'conflict');
			globalThis.__paperImporterRequestUrl = async () => ({ status: 200, text: JSON.stringify({ message: { title: ['External title'] } }) });
			const controller = new AbortController();
			const pending = service.run(new api.TFile('Papers/Example.pdf'), 'metadata', () => {}, controller.signal)
				.then(result => ({ result }), error => ({ error }));
			const query = await waitForModal(api.MetadataQueryModal);
			query.inputEl = { value: 'Local title' };
			query.submit();
			const modal = await waitForModal(stage === 'conflict' ? api.MetadataConflictModal : api.OverwriteConfirmModal);
			controller.abort();
			const outcome = await pending;
			if (stage === 'conflict') assert.equal(outcome.result, null);
			else assert.equal(outcome.error?.name, 'ImportCancelledError');
			assert.equal(modal.closed, true);
			assert.deepEqual(writes, []);
			assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
		});
	});
}
