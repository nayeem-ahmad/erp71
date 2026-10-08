import { DEFAULT_DOCUMENT_NUMBERING, type DocumentNumberingConfig } from '@erp71/shared-types';
import {
    counterRowsFor,
    periodLabel,
    previewNumber,
    storeCodeErrors,
    type DocumentNumberingData,
} from './numbering-rows';

const data: DocumentNumberingData = {
    docType: 'SALE',
    config: DEFAULT_DOCUMENT_NUMBERING.SALE,
    isDefault: true,
    today: { year: 2026, month: 10 },
    stores: [
        { id: 'dhk', name: 'Dhaka', code: 'DHK' },
        { id: 'ctg', name: 'Chattogram', code: 'CTG' },
    ],
    counters: [{ id: 'till-1', storeId: 'dhk', name: 'Front', counterNumber: 1 }],
    sequences: [
        { periodKey: '2627', scopeKey: '', nextNumber: 43 },
        { periodKey: '2627', scopeKey: 'store:ctg', nextNumber: 7 },
        { periodKey: 'M2026-10', scopeKey: '', nextNumber: 12 },
    ],
};

const config = (overrides: Partial<DocumentNumberingConfig>): DocumentNumberingConfig => ({
    ...DEFAULT_DOCUMENT_NUMBERING.SALE,
    ...overrides,
});

describe('counterRowsFor', () => {
    it('shows one business-wide counter, where this period stands', () => {
        expect(counterRowsFor(DEFAULT_DOCUMENT_NUMBERING.SALE, data)).toEqual([
            { scopeKey: '', label: 'Whole business', storeId: 'dhk', counterNumber: null, currentNext: 43 },
        ]);
    });

    it('reads the counter of the period the chosen reset would use', () => {
        const monthly = config({ template: '{YY}{MM}-{SEQ}', resetPolicy: 'MONTHLY' });
        expect(counterRowsFor(monthly, data)[0].currentNext).toBe(12);
    });

    it('shows a counter per branch, starting unstarted ones at 1', () => {
        const rows = counterRowsFor(config({ template: '{STORE}-{FY}-{SEQ}', scope: 'STORE' }), data);
        expect(rows.map((r) => [r.scopeKey, r.label, r.currentNext])).toEqual([
            ['store:dhk', 'Dhaka', 1],
            ['store:ctg', 'Chattogram', 7],
        ]);
    });

    it('shows each till and a back-office series per branch', () => {
        const rows = counterRowsFor(config({ template: '{STORE}{COUNTER}-{FY}-{SEQ}', scope: 'COUNTER' }), data);
        expect(rows.map((r) => r.scopeKey)).toEqual(['counter:till-1', 'store:dhk:none', 'store:ctg:none']);
        expect(rows[0].label).toBe('Dhaka · Front');
    });
});

describe('previewNumber', () => {
    it('renders with the branch code being edited', () => {
        const perBranch = config({ template: '{STORE}-{FY}-{SEQ}', scope: 'STORE' });
        const [dhaka] = counterRowsFor(perBranch, data);
        expect(previewNumber(perBranch, dhaka, 5, data.today, () => 'DH1')).toBe('DH1-2627-00005');
    });
});

describe('periodLabel', () => {
    it('names the current period', () => {
        expect(periodLabel(config({ resetPolicy: 'FISCAL_YEAR' }), { year: 2026, month: 10 })).toBe('Fiscal year 2026–27');
        expect(periodLabel(config({ resetPolicy: 'FISCAL_YEAR' }), { year: 2027, month: 3 })).toBe('Fiscal year 2026–27');
        expect(periodLabel(config({ resetPolicy: 'MONTHLY' }), { year: 2026, month: 10 })).toBe('October 2026');
        expect(periodLabel(config({ resetPolicy: 'CALENDAR_YEAR' }), { year: 2026, month: 10 })).toBe('Year 2026');
        expect(periodLabel(config({ resetPolicy: 'NEVER' }), { year: 2026, month: 10 })).toBe('All time (never resets)');
    });
});

describe('storeCodeErrors', () => {
    const stores = [{ id: 'a', code: 'S1' }, { id: 'b', code: 'S2' }, { id: 'c', code: 'S3' }];

    it('flags blank, unprintable and repeated codes', () => {
        expect(storeCodeErrors(stores, { a: 'dhk', b: 'DHK', c: '' })).toEqual({
            b: 'Already used by another branch.',
            c: 'Enter a code.',
        });
        expect(storeCodeErrors(stores, { a: 'D-1', b: 'TOOLONG', c: 'C1' })).toEqual({
            a: 'Use 1–6 letters or digits.',
            b: 'Use 1–6 letters or digits.',
        });
    });

    it('leaves a branch that never had a code to be assigned one on save', () => {
        expect(storeCodeErrors([{ id: 'a', code: null }], { a: '' })).toEqual({});
    });

    it('accepts distinct codes', () => {
        expect(storeCodeErrors(stores, { a: 'DHK', b: 'CTG', c: 'S3' })).toEqual({});
    });
});
