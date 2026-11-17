/** Decode by content: some supplied “UTF8” files actually use GB18030. */
export function decodeCsv(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
	}
}

/** RFC 4180 fields, including quoted commas, escaped quotes and embedded newlines. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	let closedQuote = false;
	const input = text.replace(/^\uFEFF/, '');
	const finishField = (): void => {
		row.push(field.trim());
		field = '';
		closedQuote = false;
	};
	const finishRow = (): void => {
		finishField();
		if (row.some(Boolean)) rows.push(row);
		row = [];
	};

	for (let index = 0; index < input.length; index++) {
		const char = input[index];
		if (quoted) {
			if (char === '"') {
				if (input[index + 1] === '"') {
					field += '"';
					index++;
				} else {
					quoted = false;
					closedQuote = true;
				}
			} else {
				field += char;
			}
		} else if (char === ',') {
			finishField();
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && input[index + 1] === '\n') index++;
			finishRow();
		} else if (char === '"' && field === '' && !closedQuote) {
			quoted = true;
		} else if (closedQuote && char?.trim()) {
			throw new Error('Invalid CSV: unexpected text after a closing quote.');
		} else if (!closedQuote) {
			if (char === '"') throw new Error('Invalid CSV: quote inside an unquoted field.');
			field += char;
		}
	}
	if (quoted) throw new Error('Invalid CSV: unterminated quoted field.');
	finishRow();
	return rows;
}

export function normalizeIssn(value: string): string | undefined {
	const cleaned = value.toUpperCase().replace(/[\s-]/g, '');
	return /^\d{7}[\dX]$/.test(cleaned) ? cleaned : undefined;
}

export function normalizeJournalName(value: string): string {
	return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
		.replace(/&/g, 'and').replace(/[^\p{L}\p{N}]/gu, '');
}
