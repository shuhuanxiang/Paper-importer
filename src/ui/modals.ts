import { App, Modal, Setting } from 'obsidian';
import { MetadataCandidate, MetadataField, MetadataSource, PaperMetadata, ResolvedMetadata } from '../types';
import { ImportCancelledError } from '../utils/tasks';
import { getUiLocale, uiStrings } from '../i18n';

const FIELD_LABELS: Record<MetadataField, string> = {
	title: 'Title',
	authors: 'Authors',
	year: 'Year',
	date: 'Publication date',
	doi: 'DOI',
	arxivId: 'arXiv ID',
	journal: 'Journal',
	issn: 'ISSN',
	url: 'URL',
};

const FIELD_LABELS_ZH: Record<MetadataField, string> = {
	title: '标题',
	authors: '作者',
	year: '年份',
	date: '发布日期',
	doi: 'DOI',
	arxivId: 'arXiv ID',
	journal: '期刊',
	issn: 'ISSN',
	url: 'URL',
};

function fieldLabel(field: MetadataField): string {
	return getUiLocale() === 'zh' ? FIELD_LABELS_ZH[field] : FIELD_LABELS[field];
}

function closeOnAbort(modal: Modal, signal?: AbortSignal): () => void {
	if (!signal) return () => {};
	const close = (): void => modal.close();
	signal.addEventListener('abort', close, { once: true });
	return () => signal.removeEventListener('abort', close);
}

export class MetadataQueryModal extends Modal {
	private inputEl!: HTMLInputElement;
	private settled = false;

	constructor(
		app: App,
		private readonly initialValue: string,
		private readonly onSubmit: (query: string | null) => void,
	) {
		super(app);
	}

	static ask(app: App, initialValue: string, signal?: AbortSignal): Promise<string | null> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new ImportCancelledError());
				return;
			}
			let aborted = false;
			let modal: MetadataQueryModal;
			const onAbort = (): void => {
				aborted = true;
				modal.close();
				reject(new ImportCancelledError());
			};
			modal = new MetadataQueryModal(app, initialValue, (value) => {
				signal?.removeEventListener('abort', onAbort);
				if (!aborted) resolve(value);
			});
			signal?.addEventListener('abort', onAbort, { once: true });
			modal.open();
		});
	}

	onOpen(): void {
		const text = uiStrings();
		this.titleEl.setText(text.metadataModalTitle);
		this.modalEl.classList.add('paper-importer-modal');
		this.contentEl.createEl('p', { text: text.metadataModalPrompt });
		new Setting(this.contentEl)
			.setName(text.metadataSearchQuery)
			.addText((input) => {
				input.setValue(this.initialValue).setPlaceholder(text.metadataPlaceholder);
				this.inputEl = input.inputEl;
				input.inputEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') this.submit();
				});
			});
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(text.metadataSearch).setCta().onClick(() => this.submit()))
			.addButton((button) => button.setButtonText(text.cancel).onClick(() => this.close()));
		this.inputEl.focus();
		this.inputEl.select();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.settled) this.onSubmit(null);
	}

	private submit(): void {
		const query = this.inputEl.value.trim();
		if (!query) return;
		this.settled = true;
		this.onSubmit(query);
		this.close();
	}
}

interface ConflictEditor {
	field: MetadataField;
	selector: HTMLSelectElement;
	input: HTMLTextAreaElement;
	candidates: MetadataCandidate[];
}

export class MetadataConflictModal extends Modal {
	private editors: ConflictEditor[] = [];
	private settled = false;

	constructor(
		app: App,
		private readonly fields: MetadataField[],
		private readonly candidates: MetadataCandidate[],
		private readonly onSubmit: (result: ResolvedMetadata | null) => void,
	) {
		super(app);
	}

	static resolve(
		app: App,
		fields: MetadataField[],
		candidates: MetadataCandidate[],
		signal?: AbortSignal,
	): Promise<ResolvedMetadata | null> {
		return new Promise((resolve) => {
			if (signal?.aborted) {
				resolve(null);
				return;
			}
			let settled = false;
			let removeAbortListener = (): void => {};
			const finish = (result: ResolvedMetadata | null): void => {
				if (settled) return;
				settled = true;
				removeAbortListener();
				resolve(result);
			};
			const modal = new MetadataConflictModal(app, fields, candidates, finish);
			removeAbortListener = closeOnAbort(modal, signal);
			if (signal?.aborted) finish(null);
			else modal.open();
		});
	}

	onOpen(): void {
		const text = uiStrings();
		this.titleEl.setText(text.conflictModalTitle);
		this.modalEl.classList.add('paper-importer-modal');
		this.contentEl.createEl('p', {
			text: text.conflictModalPrompt,
			cls: 'paper-importer-conflict-description',
		});

		for (const field of this.fields) this.addFieldEditor(field);

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(text.conflictConfirm).setCta().onClick(() => this.submit()))
			.addButton((button) => button.setButtonText(text.conflictCancel).onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.settled) this.onSubmit(null);
	}

	private addFieldEditor(field: MetadataField): void {
		const options = this.candidates.filter((candidate) => hasValue(candidate.metadata[field]));
		const first = options[0];
		if (!first) return;
		let selector!: HTMLSelectElement;
		let input!: HTMLTextAreaElement;
		const setting = new Setting(this.contentEl).setName(fieldLabel(field));
		setting.addDropdown((dropdown) => {
			for (const candidate of options) dropdown.addOption(candidate.source, candidate.source);
			dropdown.addOption('manual', uiStrings().manualEdit);
			dropdown.setValue(first.source);
			selector = dropdown.selectEl;
			dropdown.onChange((source) => {
				if (source === 'manual') return;
				const candidate = options.find((item) => item.source === source);
				if (candidate) input.value = formatValue(candidate.metadata[field]);
			});
		});
		setting.addTextArea((textarea) => {
			textarea.setValue(formatValue(first.metadata[field]));
			textarea.inputEl.rows = field === 'authors' ? 4 : 2;
			input = textarea.inputEl;
			textarea.inputEl.addEventListener('input', () => {
				selector.value = 'manual';
			});
		});
		this.editors.push({ field, selector, input, candidates: options });
	}

	private submit(): void {
		const metadata: PaperMetadata = {};
		const sources: ResolvedMetadata['sources'] = {};
		for (const editor of this.editors) {
			const source = editor.selector.value as MetadataSource | 'manual';
			const candidate = editor.candidates.find((item) => item.source === source);
			const value = source === 'manual'
				? parseManualValue(editor.field, editor.input.value)
				: candidate?.metadata[editor.field];
			if (!hasValue(value)) continue;
			(metadata as Record<MetadataField, PaperMetadata[MetadataField]>)[editor.field] = value;
			if (source !== 'manual' && candidate) sources[editor.field] = candidate.source;
		}
		this.settled = true;
		this.onSubmit({ metadata, sources });
		this.close();
	}
}

export class OverwriteConfirmModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private readonly paths: string[],
		private readonly onSubmit: (confirmed: boolean) => void,
	) {
		super(app);
	}

	static confirm(app: App, paths: string[], signal?: AbortSignal): Promise<boolean> {
		return new Promise((resolve) => {
			if (signal?.aborted) {
				resolve(false);
				return;
			}
			let settled = false;
			let removeAbortListener = (): void => {};
			const finish = (confirmed: boolean): void => {
				if (settled) return;
				settled = true;
				removeAbortListener();
				resolve(confirmed);
			};
			const modal = new OverwriteConfirmModal(app, paths, finish);
			removeAbortListener = closeOnAbort(modal, signal);
			if (signal?.aborted) finish(false);
			else modal.open();
		});
	}

	onOpen(): void {
		const text = uiStrings();
		this.titleEl.setText(text.overwriteModalTitle);
		this.contentEl.createEl('p', {
			text: text.overwriteModalDescription(this.paths.join(', ')),
		});
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(text.overwriteConfirm).setWarning().onClick(() => {
				this.settled = true;
				this.onSubmit(true);
				this.close();
			}))
			.addButton((button) => button.setButtonText(text.cancel).onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.settled) this.onSubmit(false);
	}
}

function hasValue(value: PaperMetadata[MetadataField] | undefined): boolean {
	return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}

function formatValue(value: PaperMetadata[MetadataField] | undefined): string {
	return Array.isArray(value) ? value.join('\n') : value ?? '';
}

function parseManualValue(field: MetadataField, value: string): PaperMetadata[MetadataField] | undefined {
	if (field === 'authors' || field === 'issn') return value.split('\n').map((author) => author.trim()).filter(Boolean);
	return value.trim();
}
