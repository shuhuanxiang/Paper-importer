export interface PaperImporterSettings {
	mineruToken: string;
	mineruEndpoint: string;
	mineruModel: 'pipeline' | 'vlm';
	language: string;
	enableOcr: boolean;
	enableFormula: boolean;
	enableTable: boolean;
	outputFolder: string;
	crossrefEnabled: boolean;
	crossrefEmail: string;
	arxivEnabled: boolean;
	journalRankingEnabled: boolean;
	requestTimeoutSeconds: number;
	pollIntervalSeconds: number;
	taskTimeoutMinutes: number;
}

export interface PaperMetadata {
	title?: string;
	authors?: string[];
	year?: string;
	date?: string;
	doi?: string;
	arxivId?: string;
	journal?: string;
	issn?: string[];
	url?: string;
}

export type MetadataSource = 'Crossref' | 'arXiv' | 'MinerU' | 'PDF';

export interface MetadataCandidate {
	source: MetadataSource;
	metadata: Partial<PaperMetadata>;
}

export type MetadataField = keyof PaperMetadata;

export interface ResolvedMetadata {
	metadata: PaperMetadata;
	sources: Partial<Record<MetadataField, MetadataSource>>;
}

export interface ExtractedImage {
	path: string;
	sourcePath: string;
	data: Uint8Array;
}

export interface MineruParseResult {
	markdown: string;
	images: ExtractedImage[];
}
