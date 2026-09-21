import { buildWorkbookBuffer, parseMatchWorkbook } from './match-workbook';
import type { CandidateRow, MatchManifest } from '@/types/match';

const manifest: MatchManifest = {
    tenantId: 'tenant-1',
    connectionId: 'conn-1',
    provider: 'EXPRESS_RETAIL_PRO',
    generatedAt: '2026-09-21T00:00:00.000Z',
    rowCount: 0,
};

function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
    return {
        entity: 'PRODUCT',
        externalId: '1',
        source: 'Express Retail Pro',
        sourceName: 'Napa 500mg',
        sourceExtra: '500mg',
        suggestedMatch: 'Square Napa 500 mg',
        matchId: 'p1',
        confidence: 'high',
        score: 0.9,
        altCandidates: [],
        altIds: [],
        decision: 'accept',
        notes: '',
        ...overrides,
    };
}

/** jsdom's File has no arrayBuffer(); hand the parser one that does. */
function asFile(buf: ArrayBuffer): File {
    const file = new File([buf as never], 'match-review.xlsx');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => buf });
    return file;
}

describe('match workbook round-trip', () => {
    it('parses back exactly the rows that were written', async () => {
        const rows = [
            row({ externalId: '1' }),
            row({ entity: 'CUSTOMER', externalId: '2', sourceName: 'Rahim' }),
        ];
        const parsed = await parseMatchWorkbook(asFile(buildWorkbookBuffer(manifest, rows)));
        expect(parsed.rows.map((r) => r.externalId).sort()).toEqual(['1', '2']);
    });

    it('preserves the manifest', async () => {
        const parsed = await parseMatchWorkbook(asFile(buildWorkbookBuffer(manifest, [row()])));
        expect(parsed.manifest.connectionId).toBe('conn-1');
        expect(parsed.manifest.provider).toBe('EXPRESS_RETAIL_PRO');
    });

    it('keeps an edited decision and note', async () => {
        const buf = buildWorkbookBuffer(manifest, [
            row({ decision: '', notes: '', altIds: ['a1'], altCandidates: ['Alt One'] }),
        ]);
        // Simulate the reviewer's edit by rewriting the cell, as Excel would.
        const XLSX = require('xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets.Products;
        ws[XLSX.utils.encode_cell({ c: 9, r: 1 })] = { t: 's', v: 'alt1' };
        ws[XLSX.utils.encode_cell({ c: 10, r: 1 })] = { t: 's', v: 'checked with the shop' };
        const edited = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

        const parsed = await parseMatchWorkbook(asFile(edited));
        expect(parsed.rows[0].decision).toBe('alt1');
        expect(parsed.rows[0].notes).toBe('checked with the shop');
    });

    it('reads external_id as a string even when it looks numeric', async () => {
        const parsed = await parseMatchWorkbook(
            asFile(buildWorkbookBuffer(manifest, [row({ externalId: '00123' })])),
        );
        expect(parsed.rows[0].externalId).toBe('00123');
    });

    it('round-trips the alternates list', async () => {
        const parsed = await parseMatchWorkbook(
            asFile(
                buildWorkbookBuffer(manifest, [
                    row({ altCandidates: ['One', 'Two'], altIds: ['a', 'b'] }),
                ]),
            ),
        );
        expect(parsed.rows[0].altIds).toEqual(['a', 'b']);
    });

    it('keeps an empty alternates list empty rather than [""]', async () => {
        const parsed = await parseMatchWorkbook(
            asFile(buildWorkbookBuffer(manifest, [row({ altCandidates: [], altIds: [] })])),
        );
        expect(parsed.rows[0].altIds).toEqual([]);
    });

    it('writes every entity to its own sheet', async () => {
        const XLSX = require('xlsx');
        const buf = buildWorkbookBuffer(manifest, [
            row({ entity: 'PRODUCT' }),
            row({ entity: 'CUSTOMER', externalId: '2' }),
            row({ entity: 'SUPPLIER', externalId: '3' }),
        ]);
        expect(XLSX.read(buf, { type: 'array' }).SheetNames).toEqual([
            'Manifest',
            'Products',
            'Customers',
            'Suppliers',
        ]);
    });

    it('puts the rows needing review at the top', async () => {
        const buf = buildWorkbookBuffer(manifest, [
            row({ externalId: 'high', confidence: 'high' }),
            row({ externalId: 'medium', confidence: 'medium', decision: '' }),
        ]);
        const parsed = await parseMatchWorkbook(asFile(buf));
        expect(parsed.rows[0].externalId).toBe('medium');
    });

    it('throws when a required sheet is missing', async () => {
        const XLSX = require('xlsx');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ field: 'x', value: 'y' }]), 'Manifest');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'Products');
        const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        await expect(parseMatchWorkbook(asFile(buf))).rejects.toThrow(/Customers/);
    });
});
