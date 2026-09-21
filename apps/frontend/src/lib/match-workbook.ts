import * as XLSX from 'xlsx';
import { parseSpreadsheetFile } from './spreadsheet';
import type { CandidateRow, MatchEntity, MatchManifest } from '@/types/match';

/**
 * The match review workbook: one tab per entity plus a manifest, carrying every
 * source record — not only the ambiguous ones — so the finished file is the
 * migration's own record of what was decided.
 */

export const ENTITY_SHEETS: Record<MatchEntity, string> = {
    PRODUCT: 'Products',
    CUSTOMER: 'Customers',
    SUPPLIER: 'Suppliers',
};

export const SHEET_NAMES = ['Manifest', 'Products', 'Customers', 'Suppliers'] as const;

/** Column order in every entity sheet. `decision` and `notes` are the editable pair. */
const COLUMNS = [
    'external_id',
    'source',
    'source_name',
    'source_extra',
    'suggested_match',
    'match_id',
    'confidence',
    'alt_candidates',
    'alt_ids',
    'decision',
    'notes',
] as const;

const DECISION_COLUMN = COLUMNS.indexOf('decision');
const EXTERNAL_ID_COLUMN = COLUMNS.indexOf('external_id');

/** Medium first: the rows that need a human are at the top of each sheet. */
const CONFIDENCE_ORDER: Record<string, number> = { medium: 0, none: 1, low: 2, high: 3 };

const ALT_SEPARATOR = ' | ';

function toSheetRow(row: CandidateRow): Record<string, string> {
    return {
        external_id: row.externalId,
        source: row.source,
        source_name: row.sourceName,
        source_extra: row.sourceExtra,
        suggested_match: row.suggestedMatch ?? '',
        match_id: row.matchId ?? '',
        confidence: row.confidence,
        alt_candidates: row.altCandidates.join(ALT_SEPARATOR),
        alt_ids: row.altIds.join(ALT_SEPARATOR),
        decision: row.decision,
        notes: row.notes,
    };
}

function splitList(value: string): string[] {
    return value.split(ALT_SEPARATOR).map((part) => part.trim()).filter(Boolean);
}

/**
 * Builds the workbook bytes. Separate from the download so it can be tested
 * without a browser.
 */
export function buildWorkbookBuffer(manifest: MatchManifest, rows: CandidateRow[]): ArrayBuffer {
    const wb = XLSX.utils.book_new();

    const manifestRows = Object.entries({ ...manifest, rowCount: rows.length }).map(([field, value]) => ({
        field,
        value: String(value),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(manifestRows), 'Manifest');

    for (const entity of Object.keys(ENTITY_SHEETS) as MatchEntity[]) {
        const forEntity = rows
            .filter((r) => r.entity === entity)
            .sort((a, b) => (CONFIDENCE_ORDER[a.confidence] ?? 9) - (CONFIDENCE_ORDER[b.confidence] ?? 9));

        const ws = XLSX.utils.json_to_sheet(forEntity.map(toSheetRow), { header: [...COLUMNS] });

        // Force external_id to text. Excel would otherwise read "00123" as the
        // number 123 and the id would no longer match anything on upload.
        for (let i = 0; i < forEntity.length; i++) {
            const address = XLSX.utils.encode_cell({ c: EXTERNAL_ID_COLUMN, r: i + 1 });
            const cell = ws[address];
            if (cell) {
                cell.t = 's';
                cell.z = '@';
                cell.v = String(cell.v);
            }
        }

        XLSX.utils.book_append_sheet(wb, ws, ENTITY_SHEETS[entity]);
    }

    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** Builds the workbook and hands it to the browser as a download. */
export function downloadMatchWorkbook(manifest: MatchManifest, rows: CandidateRow[]): void {
    const wb = XLSX.read(buildWorkbookBuffer(manifest, rows), { type: 'array' });
    const day = manifest.generatedAt.slice(0, 10);
    XLSX.writeFile(wb, `match-review-${manifest.provider}-${day}.xlsx`);
}

/** Reads a reviewed workbook back, coercing every cell to a string. */
export async function parseMatchWorkbook(
    file: File,
): Promise<{ manifest: MatchManifest; rows: CandidateRow[] }> {
    const manifestSheet = await parseSpreadsheetFile(file, 'Manifest');
    const manifestFields = Object.fromEntries(
        manifestSheet.rows.map((r) => [String(r.field ?? ''), String(r.value ?? '')]),
    );

    const manifest: MatchManifest = {
        tenantId: manifestFields.tenantId ?? '',
        connectionId: manifestFields.connectionId ?? '',
        provider: manifestFields.provider ?? '',
        generatedAt: manifestFields.generatedAt ?? '',
        rowCount: Number(manifestFields.rowCount ?? 0),
    };

    const rows: CandidateRow[] = [];
    for (const entity of Object.keys(ENTITY_SHEETS) as MatchEntity[]) {
        // Throws naming the sheets it did find when one is missing.
        const parsed = await parseSpreadsheetFile(file, ENTITY_SHEETS[entity]);

        for (const raw of parsed.rows) {
            const externalId = String(raw.external_id ?? '').trim();
            // json_to_sheet writes no row for a fully blank record; guard anyway
            // so a stray trailing row cannot become a phantom decision.
            if (!externalId) continue;

            rows.push({
                entity,
                externalId,
                source: String(raw.source ?? ''),
                sourceName: String(raw.source_name ?? ''),
                sourceExtra: String(raw.source_extra ?? ''),
                suggestedMatch: String(raw.suggested_match ?? '') || null,
                matchId: String(raw.match_id ?? '') || null,
                confidence: (String(raw.confidence ?? 'none') || 'none') as CandidateRow['confidence'],
                score: 0,
                altCandidates: splitList(String(raw.alt_candidates ?? '')),
                altIds: splitList(String(raw.alt_ids ?? '')),
                decision: String(raw.decision ?? '').trim() as CandidateRow['decision'],
                notes: String(raw.notes ?? ''),
            });
        }
    }

    return { manifest, rows };
}

/** The editable column, for the UI to explain which one the reviewer fills in. */
export const DECISION_COLUMN_INDEX = DECISION_COLUMN;
