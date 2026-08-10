import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedSpreadsheet {
    headers: string[];
    rows: Record<string, string>[];
}

/** Reads a .csv, .xlsx or .xls file in the browser. The first sheet wins. */
export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
    const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
    if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
        throw new Error(`Unsupported file type ".${ext ?? ''}". Please upload a .csv or .xlsx file.`);
    }

    if (ext === 'csv') {
        const text = await file.text();
        // Papa's `errors` array includes non-fatal notices (e.g. "Unable to
        // auto-detect delimiting character" for a single-column CSV) even when
        // parsing succeeded, so — like the original callback-based parseFile,
        // which never inspected `results.errors` — this doesn't treat it as fatal.
        const parsed = Papa.parse<Record<string, string>>(text, {
            header: true,
            skipEmptyLines: true,
        });
        return { headers: parsed.meta.fields ?? [], rows: parsed.data };
    }

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
    return { headers: json.length > 0 ? Object.keys(json[0]) : [], rows: json };
}

/** Guesses which spreadsheet header feeds which field, by label then by key. */
export function autoMapHeaders(
    headers: string[],
    fields: { key: string; label: string }[],
): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const field of fields) {
        const match = headers.find(
            (h) =>
                h.trim().toLowerCase() === field.label.toLowerCase() ||
                h.trim().toLowerCase() === field.key.toLowerCase(),
        );
        mapping[field.key] = match ?? '';
    }
    return mapping;
}
