import { Menu, Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, PaperImporterSettingTab } from './settings';
import { PaperImportService, ImportMode } from './importer';
import { ImportCancelledError } from './utils/tasks';
import { PaperImporterSettings } from './types';
import { getUiLocale, uiStrings } from './i18n';
import { JournalRankingService } from './journal/service';

export default class PaperImporterPlugin extends Plugin {
	settings!: PaperImporterSettings;
	journalRankings!: JournalRankingService;
	private importService!: PaperImportService;
	private activeController: AbortController | undefined;

	async onload(): Promise<void> {
		await this.loadSettings();
		const text = uiStrings();
		this.journalRankings = new JournalRankingService(
			this.app.vault.adapter,
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
		);
		this.importService = new PaperImportService(this.app, () => this.settings, this.journalRankings);

		this.addRibbonIcon('file-input', text.ribbonImport, () => {
			const file = this.activePdf();
			if (file) void this.startImport(file, 'combined');
			else new Notice(text.noActivePdf);
		});

		this.addCommand({
			id: 'parse-current-pdf',
			name: text.commandParse,
			checkCallback: (checking) => this.withActivePdf(checking, 'parse'),
		});
		this.addCommand({
			id: 'fetch-current-pdf-metadata',
			name: text.commandMetadata,
			checkCallback: (checking) => this.withActivePdf(checking, 'metadata'),
		});
		this.addCommand({
			id: 'import-current-pdf',
			name: text.commandCombined,
			checkCallback: (checking) => this.withActivePdf(checking, 'combined'),
		});
		this.addCommand({
			id: 'cancel-active-import',
			name: text.commandCancel,
			checkCallback: (checking) => {
				if (!this.activeController) return false;
				if (!checking) this.activeController.abort();
				return true;
			},
		});

		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'pdf') return;
			this.addPdfMenuItems(menu, file);
		}));
		this.addSettingTab(new PaperImporterSettingTab(this.app, this));
	}

	onunload(): void {
		this.activeController?.abort();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<PaperImporterSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private activePdf(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		return file?.extension.toLowerCase() === 'pdf' ? file : null;
	}

	private withActivePdf(checking: boolean, mode: ImportMode): boolean {
		const file = this.activePdf();
		if (!file) return false;
		if (!checking) void this.startImport(file, mode);
		return true;
	}

	private addPdfMenuItems(menu: Menu, file: TFile): void {
		menu.addItem((item) => item
			.setTitle(uiStrings().menuParse)
			.setIcon('file-text')
			.onClick(() => void this.startImport(file, 'parse')));
		menu.addItem((item) => item
			.setTitle(uiStrings().menuMetadata)
			.setIcon('database')
			.onClick(() => void this.startImport(file, 'metadata')));
		menu.addItem((item) => item
			.setTitle(uiStrings().menuCombined)
			.setIcon('combine')
			.onClick(() => void this.startImport(file, 'combined')));
	}

	private async startImport(file: TFile, mode: ImportMode): Promise<void> {
		const text = uiStrings();
		if (this.activeController) {
			new Notice(text.importRunning);
			return;
		}
		const controller = new AbortController();
		this.activeController = controller;
		const progress = new Notice(text.importPreparing, 0);
		try {
			const result = await this.importService.run(file, mode, (message) => progress.setMessage(message), controller.signal);
			progress.hide();
			if (!result) {
				new Notice(text.importCancelled);
				return;
			}
			new Notice(text.importSaved(result.notePath), 7000);
			if (result.warnings.length) new Notice(text.importWarnings(result.warnings.join(getUiLocale() === 'zh' ? '；' : '; ')), 10000);
		} catch (error) {
			progress.hide();
			if (error instanceof ImportCancelledError) {
				new Notice(text.importCancelled);
				return;
			}
			const message = error instanceof Error ? error.message : text.unknownError;
			new Notice(text.importFailed(message), 10000);
		} finally {
			if (this.activeController === controller) this.activeController = undefined;
		}
	}
}
