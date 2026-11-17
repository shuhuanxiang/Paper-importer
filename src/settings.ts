import { App, PluginSettingTab, Setting } from 'obsidian';
import PaperImporterPlugin from './main';
import { PaperImporterSettings } from './types';
import { uiStrings } from './i18n';
import { addJournalRankingSettings } from './ui/journal-settings';

export const DEFAULT_SETTINGS: PaperImporterSettings = {
	mineruToken: '',
	mineruEndpoint: 'https://mineru.net/api/v4',
	mineruModel: 'vlm',
	language: 'en',
	enableOcr: false,
	enableFormula: true,
	enableTable: true,
	outputFolder: 'MinerU',
	crossrefEnabled: true,
	crossrefEmail: '',
	arxivEnabled: true,
	journalRankingEnabled: true,
	requestTimeoutSeconds: 60,
	pollIntervalSeconds: 3,
	taskTimeoutMinutes: 10,
};

export class PaperImporterSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: PaperImporterPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const text = uiStrings();
		containerEl.empty();

		new Setting(containerEl).setName(text.settingsMineru).setHeading();
		new Setting(containerEl)
			.setName(text.settingsApiToken)
			.setDesc(text.settingsApiTokenDesc)
			.addText((input) => {
				input.setPlaceholder(text.settingsApiTokenPlaceholder).setValue(this.plugin.settings.mineruToken);
				input.inputEl.type = 'password';
				input.onChange(async (value) => {
					this.plugin.settings.mineruToken = value.trim();
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName(text.settingsEndpoint)
			.setDesc(text.settingsEndpointDesc)
			.addText((input) => input
				.setPlaceholder('https://mineru.net/api/v4')
				.setValue(this.plugin.settings.mineruEndpoint)
				.onChange(async (value) => {
					this.plugin.settings.mineruEndpoint = value.trim();
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName(text.settingsModel)
			.setDesc(text.settingsModelDesc)
			.addDropdown((dropdown) => dropdown
				.addOption('vlm', text.settingsVlm)
				.addOption('pipeline', text.settingsPipeline)
				.setValue(this.plugin.settings.mineruModel)
				.onChange(async (value) => {
					this.plugin.settings.mineruModel = value as PaperImporterSettings['mineruModel'];
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName(text.settingsDocumentLanguage)
			.setDesc(text.settingsDocumentLanguageDesc)
			.addText((input) => input
				.setPlaceholder('en')
				.setValue(this.plugin.settings.language)
				.onChange(async (value) => {
					this.plugin.settings.language = value.trim() || 'en';
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName(text.settingsEnableOcr)
			.setDesc(text.settingsEnableOcrDesc)
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableOcr)
				.onChange(async (value) => {
					this.plugin.settings.enableOcr = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName(text.settingsFormulas)
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableFormula)
				.onChange(async (value) => {
					this.plugin.settings.enableFormula = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName(text.settingsTables)
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableTable)
				.onChange(async (value) => {
					this.plugin.settings.enableTable = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName(text.settingsMetadataSources).setHeading();
		new Setting(containerEl)
			.setName(text.settingsSearchCrossref)
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.crossrefEnabled)
				.onChange(async (value) => {
					this.plugin.settings.crossrefEnabled = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName(text.settingsCrossrefEmail)
			.setDesc(text.settingsCrossrefEmailDesc)
			.addText((input) => input
				.setPlaceholder('name@example.org')
				.setValue(this.plugin.settings.crossrefEmail)
				.onChange(async (value) => {
					this.plugin.settings.crossrefEmail = value.trim();
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName(text.settingsSearchArxiv)
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.arxivEnabled)
				.onChange(async (value) => {
					this.plugin.settings.arxivEnabled = value;
					await this.plugin.saveSettings();
				}));

		addJournalRankingSettings(containerEl, this.plugin);

		new Setting(containerEl).setName(text.settingsLimits).setHeading();
		new Setting(containerEl)
			.setName(text.settingsRequestTimeout)
			.setDesc(text.settingsRequestTimeoutDesc)
			.addText((input) => {
				input.setPlaceholder('60').setValue(String(this.plugin.settings.requestTimeoutSeconds));
				input.inputEl.type = 'number';
				input.onChange(async (value) => {
					this.plugin.settings.requestTimeoutSeconds = parseInteger(value, 60, 5, 300);
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName(text.settingsPollInterval)
			.setDesc(text.settingsPollIntervalDesc)
			.addText((input) => {
				input.setPlaceholder('3').setValue(String(this.plugin.settings.pollIntervalSeconds));
				input.inputEl.type = 'number';
				input.onChange(async (value) => {
					this.plugin.settings.pollIntervalSeconds = parseInteger(value, 3, 1, 60);
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName(text.settingsTaskTimeout)
			.setDesc(text.settingsTaskTimeoutDesc)
			.addText((input) => {
				input.setPlaceholder('10').setValue(String(this.plugin.settings.taskTimeoutMinutes));
				input.inputEl.type = 'number';
				input.onChange(async (value) => {
					this.plugin.settings.taskTimeoutMinutes = parseInteger(value, 10, 1, 120);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName(text.settingsOutput).setHeading();
		new Setting(containerEl)
			.setName(text.settingsOutputFolder)
			.setDesc(text.settingsOutputFolderDesc)
			.addText((input) => input
				.setPlaceholder(text.settingsOutputFolderPlaceholder)
				.setValue(this.plugin.settings.outputFolder)
				.onChange(async (value) => {
					this.plugin.settings.outputFolder = value.trim() || 'MinerU';
					await this.plugin.saveSettings();
				}));
	}
}

function parseInteger(value: string, fallback: number, minimum: number, maximum: number): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(maximum, Math.max(minimum, parsed));
}
