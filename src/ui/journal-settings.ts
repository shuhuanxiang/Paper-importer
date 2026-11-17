import { ButtonComponent, Notice, Setting } from 'obsidian';
import type PaperImporterPlugin from '../main';
import { uiStrings } from '../i18n';
import { JournalLibrarySummary } from '../journal/types';

export function addJournalRankingSettings(containerEl: HTMLElement, plugin: PaperImporterPlugin): void {
	const text = uiStrings();
	new Setting(containerEl).setName(text.settingsJournalRankings).setHeading();
	new Setting(containerEl)
		.setName(text.settingsEnableJournalRankings)
		.setDesc(text.settingsEnableJournalRankingsDesc)
		.addToggle((toggle) => toggle.setValue(plugin.settings.journalRankingEnabled).onChange(async (value) => {
			plugin.settings.journalRankingEnabled = value;
			await plugin.saveSettings();
		}));
	const librarySetting = new Setting(containerEl)
		.setName(text.settingsJournalLibrary)
		.setDesc(text.settingsJournalLibraryDesc);
	const status = containerEl.createEl('p', { cls: 'setting-item-description', text: text.journalLibraryEmpty });
	const showSummary = (summary: JournalLibrarySummary): void => {
		status.setText(summary.sources ? text.journalLibrarySummary(summary.sources, summary.entries) : text.journalLibraryEmpty);
	};
	void plugin.journalRankings.summary().then(showSummary).catch((error: unknown) => {
		status.setText(text.journalRankingFailed(error instanceof Error ? error.message : text.unknownError));
	});

	const input = containerEl.createEl('input', { type: 'file', cls: 'paper-importer-library-input' });
	input.accept = '.csv,.json,.gz';
	input.multiple = true;
	let importButton: ButtonComponent;
	librarySetting.addButton((button) => {
		importButton = button;
		button.setButtonText(text.importJournalLibrary).onClick(() => input.click());
	});
	plugin.registerDomEvent(input, 'change', () => {
		const files = Array.from(input.files ?? []);
		if (!files.length) return;
		importButton.setDisabled(true);
		status.setText(text.journalLibraryImporting);
		void plugin.journalRankings.importFiles(files)
			.then((summary) => {
				showSummary(summary);
				new Notice(text.journalLibraryImported(summary.sources, summary.entries));
			})
			.catch((error: unknown) => {
				const message = text.journalLibraryFailed(error instanceof Error ? error.message : text.unknownError);
				status.setText(message);
				new Notice(message, 10000);
			})
			.finally(() => {
				importButton.setDisabled(false);
				input.value = '';
			});
	});
}
