import { getLanguage } from 'obsidian';

export type UiLocale = 'en' | 'zh';

export interface UiStrings {
	settingsMineru: string;
	settingsApiToken: string;
	settingsApiTokenDesc: string;
	settingsApiTokenPlaceholder: string;
	settingsEndpoint: string;
	settingsEndpointDesc: string;
	settingsModel: string;
	settingsModelDesc: string;
	settingsVlm: string;
	settingsPipeline: string;
	settingsDocumentLanguage: string;
	settingsDocumentLanguageDesc: string;
	settingsEnableOcr: string;
	settingsEnableOcrDesc: string;
	settingsFormulas: string;
	settingsTables: string;
	settingsMetadataSources: string;
	settingsSearchCrossref: string;
	settingsCrossrefEmail: string;
	settingsCrossrefEmailDesc: string;
	settingsSearchArxiv: string;
	settingsJournalRankings: string;
	settingsEnableJournalRankings: string;
	settingsEnableJournalRankingsDesc: string;
	settingsJournalLibrary: string;
	settingsJournalLibraryDesc: string;
	importJournalLibrary: string;
	journalLibraryEmpty: string;
	journalLibrarySummary: (sources: number, entries: number) => string;
	journalLibraryImported: (sources: number, entries: number) => string;
	journalLibraryImporting: string;
	journalLibraryFailed: (message: string) => string;
	queryJournalRanking: string;
	journalRankingFailed: (message: string) => string;
	settingsLimits: string;
	settingsRequestTimeout: string;
	settingsRequestTimeoutDesc: string;
	settingsPollInterval: string;
	settingsPollIntervalDesc: string;
	settingsTaskTimeout: string;
	settingsTaskTimeoutDesc: string;
	settingsOutput: string;
	settingsOutputFolder: string;
	settingsOutputFolderDesc: string;
	settingsOutputFolderPlaceholder: string;
	ribbonImport: string;
	noActivePdf: string;
	commandParse: string;
	commandMetadata: string;
	commandCombined: string;
	commandCancel: string;
	menuParse: string;
	menuMetadata: string;
	menuCombined: string;
	importPreparing: string;
	importRunning: string;
	importCancelled: string;
	importSaved: (path: string) => string;
	importWarnings: (warnings: string) => string;
	importFailed: (message: string) => string;
	unknownError: string;
	metadataSourceDisabled: string;
	sourcePdfHeading: string;
	metadataModalTitle: string;
	metadataModalPrompt: string;
	metadataSearchQuery: string;
	metadataSearch: string;
	cancel: string;
	metadataPlaceholder: string;
	conflictModalTitle: string;
	conflictModalPrompt: string;
	conflictConfirm: string;
	conflictCancel: string;
	manualEdit: string;
	overwriteModalTitle: string;
	overwriteModalDescription: (paths: string) => string;
	overwriteConfirm: string;
	selectPdf: string;
	readPdfMetadata: string;
	readPdf: string;
	queryMetadata: string;
	organizeMetadata: string;
	writeOutput: string;
	noMetadata: (detail: string) => string;
	cancelledExisting: string;
}

const EN: UiStrings = {
	settingsMineru: 'MinerU parsing',
	settingsApiToken: 'API token',
	settingsApiTokenDesc: 'PDF files are uploaded to MinerU for parsing. The token is stored in this vault’s plugin data.',
	settingsApiTokenPlaceholder: 'MinerU API token',
	settingsEndpoint: 'API endpoint',
	settingsEndpointDesc: 'MinerU v4 API base URL.',
	settingsModel: 'Model',
	settingsModelDesc: 'VLM is recommended for papers with complex layouts.',
	settingsVlm: 'VLM',
	settingsPipeline: 'Pipeline',
	settingsDocumentLanguage: 'Document language',
	settingsDocumentLanguageDesc: 'MinerU language code, for example en or ch.',
	settingsEnableOcr: 'Enable OCR',
	settingsEnableOcrDesc: 'Use OCR for scanned pages.',
	settingsFormulas: 'Recognize formulas',
	settingsTables: 'Recognize tables',
	settingsMetadataSources: 'Metadata sources',
	settingsSearchCrossref: 'Search Crossref',
	settingsCrossrefEmail: 'Crossref contact email',
	settingsCrossrefEmailDesc: 'Optional. Identifies requests to Crossref’s polite pool.',
	settingsSearchArxiv: 'Search arXiv',
	settingsJournalRankings: 'Journal rankings',
	settingsEnableJournalRankings: 'Add journal ranking tags',
	settingsEnableJournalRankingsDesc: 'Look up the journal in your local library after retrieving metadata. No network requests are made for rankings.',
	settingsJournalLibrary: 'Local ranking library',
	settingsJournalLibraryDesc: 'Import multiple CSV files, a JSON library, or a gzip library. Reimporting a table updates it and keeps the other tables. Each grading system uses its latest imported year; historical warnings are retained.',
	importJournalLibrary: 'Import library',
	journalLibraryEmpty: 'No ranking tables imported yet.',
	journalLibrarySummary: (sources, entries) => `${sources} tables, ${entries.toLocaleString()} ranking records.`,
	journalLibraryImported: (sources, entries) => `Journal library saved: ${sources} tables, ${entries.toLocaleString()} ranking records.`,
	journalLibraryImporting: 'Importing journal library…',
	journalLibraryFailed: (message) => `Journal library import failed: ${message}`,
	queryJournalRanking: 'Looking up local journal rankings…',
	journalRankingFailed: (message) => `Journal rankings: ${message}`,
	settingsLimits: 'Network and task limits',
	settingsRequestTimeout: 'Request timeout (seconds)',
	settingsRequestTimeoutDesc: 'Maximum time to wait for one API request.',
	settingsPollInterval: 'Poll interval (seconds)',
	settingsPollIntervalDesc: 'Time between MinerU task status checks.',
	settingsTaskTimeout: 'Task timeout (minutes)',
	settingsTaskTimeoutDesc: 'Maximum time to wait for MinerU to finish parsing.',
	settingsOutput: 'Output',
	settingsOutputFolder: 'Output folder',
	settingsOutputFolderDesc: 'Generated notes and image assets are saved here. The source PDF stays in its current location.',
	settingsOutputFolderPlaceholder: 'MinerU',
	ribbonImport: 'Import PDF',
	noActivePdf: 'Open a PDF in the vault first.',
	commandParse: 'Parse current PDF to MinerU',
	commandMetadata: 'Get metadata for current PDF',
	commandCombined: 'Parse PDF and get metadata',
	commandCancel: 'Cancel current paper import',
	menuParse: 'Parse to MinerU',
	menuMetadata: 'Get paper metadata',
	menuCombined: 'Parse and get metadata',
	importPreparing: 'Preparing paper import…',
	importRunning: 'A paper import is already running.',
	importCancelled: 'Import cancelled.',
	importSaved: (path) => `Saved: ${path}`,
	importWarnings: (warnings) => `Metadata or journal ranking warnings: ${warnings}`,
	importFailed: (message) => `Import failed: ${message}`,
	unknownError: 'An unknown error occurred.',
	metadataSourceDisabled: 'No metadata sources are enabled.',
	sourcePdfHeading: 'Source PDF',
	metadataModalTitle: 'Find paper metadata',
	metadataModalPrompt: 'Enter a DOI, arXiv ID, or paper title.',
	metadataSearchQuery: 'Search query',
	metadataSearch: 'Search',
	cancel: 'Cancel',
	metadataPlaceholder: '10.1234/example or paper title',
	conflictModalTitle: 'Confirm metadata conflicts',
	conflictModalPrompt: 'Sources disagree on these fields. Choose a source or edit the value before creating the note.',
	conflictConfirm: 'Confirm and continue',
	conflictCancel: 'Cancel import',
	manualEdit: 'Manual edit',
	overwriteModalTitle: 'Replace existing import files?',
	overwriteModalDescription: (paths) => `These generated files already exist: ${paths}. The source PDF will remain unchanged.`,
	overwriteConfirm: 'Replace generated files',
	selectPdf: 'Select a PDF file first.',
	readPdfMetadata: 'Reading PDF metadata…',
	readPdf: 'Reading PDF from the vault…',
	queryMetadata: 'Querying Crossref and arXiv…',
	organizeMetadata: 'Organizing metadata…',
	writeOutput: 'Writing Markdown and images to the vault…',
	noMetadata: (detail) => `No usable metadata was found.${detail}`,
	cancelledExisting: 'Import cancelled. Existing files were not changed.',
};

const ZH: UiStrings = {
	settingsMineru: 'MinerU 解析',
	settingsApiToken: 'API Token',
	settingsApiTokenDesc: 'PDF 将上传至 MinerU 进行解析。Token 保存在当前库的插件数据中。',
	settingsApiTokenPlaceholder: 'MinerU API Token',
	settingsEndpoint: 'API 地址',
	settingsEndpointDesc: 'MinerU v4 API 基础地址。',
	settingsModel: '模型',
	settingsModelDesc: '复杂论文版式建议使用 VLM。',
	settingsVlm: 'VLM',
	settingsPipeline: 'Pipeline',
	settingsDocumentLanguage: '文档语言',
	settingsDocumentLanguageDesc: 'MinerU 语言代码，例如 en 或 ch。',
	settingsEnableOcr: '启用 OCR',
	settingsEnableOcrDesc: '用于扫描版页面。',
	settingsFormulas: '识别公式',
	settingsTables: '识别表格',
	settingsMetadataSources: '元数据来源',
	settingsSearchCrossref: '查询 Crossref',
	settingsCrossrefEmail: 'Crossref 联系邮箱',
	settingsCrossrefEmailDesc: '可选。用于进入 Crossref 礼貌请求池。',
	settingsSearchArxiv: '查询 arXiv',
	settingsJournalRankings: '期刊等级',
	settingsEnableJournalRankings: '添加期刊等级标签',
	settingsEnableJournalRankingsDesc: '获取元信息后，查询本地等级库并生成标签。等级查询无需联网。',
	settingsJournalLibrary: '本地等级库',
	settingsJournalLibraryDesc: '可同时导入多个 CSV，也可导入 JSON 或 gzip 等级库。重复导入同一张表会更新该表，其他表格保留。各评级体系使用已导入的最新年份，历年预警记录单独保留。',
	importJournalLibrary: '导入等级库',
	journalLibraryEmpty: '尚未导入等级表。',
	journalLibrarySummary: (sources, entries) => `已导入 ${sources} 张表，共 ${entries.toLocaleString()} 条等级记录。`,
	journalLibraryImported: (sources, entries) => `等级库已保存：${sources} 张表，共 ${entries.toLocaleString()} 条等级记录。`,
	journalLibraryImporting: '正在导入期刊等级库…',
	journalLibraryFailed: (message) => `等级库导入失败：${message}`,
	queryJournalRanking: '正在查询本地期刊等级…',
	journalRankingFailed: (message) => `期刊等级：${message}`,
	settingsLimits: '网络与任务限制',
	settingsRequestTimeout: '请求超时（秒）',
	settingsRequestTimeoutDesc: '单次 API 请求的最长等待时间。',
	settingsPollInterval: '轮询间隔（秒）',
	settingsPollIntervalDesc: 'MinerU 任务状态检查之间的等待时间。',
	settingsTaskTimeout: '任务超时（分钟）',
	settingsTaskTimeoutDesc: '等待 MinerU 完成解析的最长时间。',
	settingsOutput: '输出',
	settingsOutputFolder: '输出目录',
	settingsOutputFolderDesc: '生成的笔记和图片保存在这里。原 PDF 保持在当前路径。',
	settingsOutputFolderPlaceholder: 'MinerU',
	ribbonImport: '导入 PDF',
	noActivePdf: '请先打开库中的 PDF 文件。',
	commandParse: '解析当前 PDF 到 MinerU',
	commandMetadata: '获取当前 PDF 元数据',
	commandCombined: '解析 PDF 并获取元数据',
	commandCancel: '取消当前论文导入',
	menuParse: '解析到 MinerU',
	menuMetadata: '获取论文元数据',
	menuCombined: '解析并获取元数据',
	importPreparing: '正在准备论文导入…',
	importRunning: '已有论文导入任务正在运行。',
	importCancelled: '已取消导入。',
	importSaved: (path) => `已保存：${path}`,
	importWarnings: (warnings) => `元信息或期刊等级提示：${warnings}`,
	importFailed: (message) => `导入失败：${message}`,
	unknownError: '发生未知错误。',
	metadataSourceDisabled: '未启用任何元数据来源。',
	sourcePdfHeading: '源 PDF',
	metadataModalTitle: '查找论文元数据',
	metadataModalPrompt: '请输入 DOI、arXiv ID 或论文标题。',
	metadataSearchQuery: '查询内容',
	metadataSearch: '查询',
	cancel: '取消',
	metadataPlaceholder: '10.1234/example 或论文标题',
	conflictModalTitle: '确认元数据冲突',
	conflictModalPrompt: '不同来源的以下字段存在差异。请选择来源或编辑内容后再生成笔记。',
	conflictConfirm: '确认并继续',
	conflictCancel: '取消导入',
	manualEdit: '手动编辑',
	overwriteModalTitle: '替换已有导入文件？',
	overwriteModalDescription: (paths) => `以下生成文件已经存在：${paths}。原 PDF 将保持不变。`,
	overwriteConfirm: '替换生成文件',
	selectPdf: '请先选择 PDF 文件。',
	readPdfMetadata: '正在读取 PDF 元信息…',
	readPdf: '正在从库中读取 PDF…',
	queryMetadata: '正在查询 Crossref 与 arXiv…',
	organizeMetadata: '正在整理元数据…',
	writeOutput: '正在写入 Markdown 和图片到库内…',
	noMetadata: (detail) => `没有找到可用的元数据。${detail}`,
	cancelledExisting: '导入已取消，现有文件未更改。',
};

export function getUiLocale(): UiLocale {
	return /^zh(?:-|$)/i.test(getLanguage()) ? 'zh' : 'en';
}

export function uiStrings(locale: UiLocale = getUiLocale()): UiStrings {
	return locale === 'zh' ? ZH : EN;
}
