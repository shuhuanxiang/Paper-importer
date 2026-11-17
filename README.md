# Paper Importer

Obsidian plugin for parsing papers stored in the vault with MinerU and retrieving bibliographic metadata from Crossref and arXiv.

## Features

- Parse a vault PDF with the MinerU v4 API and save the returned Markdown, formulas, tables, and images.
- Retrieve metadata independently using PDF document information and first-page text, then confirm or edit a DOI, arXiv ID, or paper title before lookup. This mode does not upload the PDF to MinerU.
- Combine PDF parsing with Crossref and arXiv lookup. Abstracts are excluded from metadata and metadata conflict dialogs.
- Match journals against an offline ranking library and add year-specific CCF, CCF T-tier, JCR, CAS, Xinrui, conference, and historical warning tags.
- Require confirmation whenever enabled metadata sources disagree on a field. Import is cancelled without writing files when the dialog is cancelled.
- Save generated notes and assets under `MinerU/<source PDF name>/`. The source PDF remains at its original path and is not copied.
- Ask before replacing any generated files already present at the output path.
- Show progress for long tasks, support cancellation, retry transient GET requests, and expose request, polling, and task timeouts in settings.

## Setup

1. Build the plugin with `npm ci` and `npm run build`.
2. Install `main.js`, `manifest.json`, and `styles.css` in `<vault>/.obsidian/plugins/paper-importer/`.
3. Enable Paper Importer in **Settings → Community plugins**.
4. Open **Settings → Paper Importer** and enter a MinerU API token. Configure the model, language, OCR, formula and table options, metadata sources, and output folder as needed.

MinerU API tokens can be created in the MinerU API management page. PDF bytes are uploaded to MinerU for parsing. Crossref and arXiv requests send the search query or identifiers to their respective public APIs. API tokens are stored in this vault's Obsidian plugin data; they are not written into generated notes.

## Use

Open a PDF in the vault, then use the command palette or the PDF's file context menu:

- **Parse current PDF to MinerU** creates a note from MinerU's parsed Markdown.
- **Get metadata for current PDF** reads local PDF metadata and the first two pages, lets you confirm or edit the query, and creates a metadata note without uploading or parsing the PDF.
- **Parse PDF and get metadata** parses the PDF and queries both enabled metadata providers using the detected DOI, arXiv ID, or title.

When metadata conflicts, choose a source or edit each conflicting value and confirm. Cancelling the conflict dialog leaves the vault unchanged. If output files already exist, choose whether to replace the generated files or cancel.

## Output

For `Papers/Example.pdf`, the default output is:

```text
MinerU/
  Papers/
    Example/
      Example.md
      assets/
        images/
          ...
```

The note contains YAML properties for available metadata, the source PDF link, and per-field metadata provenance. Image links in MinerU Markdown are rewritten to local paths. Metadata-only notes include the title and source PDF link. No `abstract` property or metadata-generated abstract section is saved; abstracts in MinerU's parsed document body and existing note bodies are preserved.

## Journal ranking library

Open **Settings → Paper Importer → Journal rankings → Import library** (中文：**设置 → Paper Importer → 期刊等级 → 导入等级库**). Select multiple supplied CSV files or one `.json` / `.json.gz` library. The plugin recognizes the supplied table headers, including CCF A/B/C, CCF T1/T2/T3, JCR quartiles, CAS partitions, Xinrui journal and conference partitions, and warning lists. UTF-8, UTF-8 with BOM, and GB18030 CSV files are supported. Chinese journal names and conference abbreviations are retained when an English name is missing.

To prepare a single library from the CSV files in this repository:

```bash
npm run build:rankings
```

This produces `dist/journal-rankings.json.gz`. The 11 supplied tables produce 65,329 usable ranking records (records across different systems and years are counted separately; JCR rows without a valid quartile are excluded). Import that file in settings, or copy it alongside `main.js` in the installed plugin directory before loading the plugin. The library is optional and kept separate from the JavaScript bundle. To use another input directory or output path:

```bash
npm run build:rankings -- /path/to/csv /path/to/journal-rankings.json.gz
```

Imported data is saved as `<vault>/.obsidian/plugins/paper-importer/journal-rankings.json.gz`, independently of API tokens and settings. Reimporting a table with the same source name, system, and year replaces that table; other tables remain available. All selected files are validated before the installed library is updated. Ranking lookup is entirely local and the index is created on first use. Adding or updating the library affects subsequent paper imports; existing notes are not scanned or rewritten automatically.

Matching and selection rules:

- Prefer ISSN/EISSN returned by Crossref. Fall back to exact normalized journal names or aliases, ignoring case, punctuation, spaces, accents, and `&` versus `and`. Conflicting ISSNs and ambiguous abbreviations are skipped; there is no fuzzy matching.
- Each grading system uses its newest imported year, independently of the paper's publication year. Different systems remain separate.
- JCR uses the best valid quartile across categories. CAS uses the major-category partition. Xinrui uses the best major-category partition when more than one is listed. Top status is retained.
- Historical warning records retain their original years and reasons. A warning from 2020 is labeled as a 2020 record, even when the journal is absent from a newer list.
- Unmatched journals receive no ranking tags. Disable **Add journal ranking tags** to skip lookup.

For example, a match can add these properties in addition to bibliographic metadata:

```yaml
journal_rank:
  - "CCF 2026 A"
  - "JCR 2025 Q1"
  - "中科院 2025 1区 Top"
tags:
  - "journal/CCF-2026/A"
  - "journal/JCR-2025/Q1"
  - "journal/CAS-2025/1区"
  - "journal/CAS-2025/Top"
journal_rank_sources:
  - "CCF2026-UTF8.csv"
  - "JCR2025-UTF8.csv"
  - "FQBJCR2025-UTF8.csv"
```

Warnings and other source annotations are saved in `journal_rank_notes` when available. For custom data providers, the JSON import interface accepts the following versioned format (plain UTF-8 JSON or gzip-compressed JSON):

```json
{
  "version": 1,
  "sources": [{
    "name": "my-jcr-2025.csv",
    "system": "JCR",
    "year": 2025,
    "entries": [{
      "names": ["Example Journal", "期刊别名"],
      "issns": ["1234-567X"],
      "rank": "Q1"
    }]
  }]
}
```

Supported `system` values are `CCF`, `CCF-T`, `JCR`, `CAS`, `XR`, `XR-conference`, and `Warning`. Ranks are respectively `A`–`C`, `T1`–`T3`, `Q1`–`Q4`, `1区`–`4区` for the three partition systems, and `低` / `中` / `高` / `预警`. Each entry requires `names` and `issns` arrays (`issns` may be empty), and may include `top: true` and a `note` string. Names can contain exact aliases, including Chinese names and conference abbreviations.

## Development

```bash
npm ci
npm run dev
npm run build
npm run lint
npm test
```

`npm test` checks CSV encoding and quoting, matching and year selection, compressed library persistence, failed-batch preservation, metadata output without abstracts, and conversion of all supplied tables. It also checks cancellation during metadata conflicts and overwrite confirmation without vault writes, abort listener cleanup, GET retries for transport errors, timeouts and HTTP 429/5xx, and cancellation during retry backoff. Regenerate the ranking library after changing the source CSV files.

The plugin targets Obsidian 1.8.7 or newer. The settings panel and plugin dialogs follow Obsidian’s current language for Chinese and English; other locales use English fallback text. Set the MinerU token before using parsing commands. The generated note keeps the original PDF link and never copies the source PDF.
