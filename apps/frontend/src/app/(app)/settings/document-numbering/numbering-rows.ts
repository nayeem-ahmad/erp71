import {
    normalizeStoreCode,
    numberingPeriodKey,
    renderDocumentNumber,
    type DocumentNumberingConfig,
    type NumberingDocType,
} from '@erp71/shared-types';

/** What GET /document-numbering/:docType returns. */
export interface DocumentNumberingData {
    docType: NumberingDocType;
    config: DocumentNumberingConfig;
    isDefault: boolean;
    today: { year: number; month: number };
    stores: { id: string; name: string; code: string | null }[];
    counters: { id: string; storeId: string; name: string; counterNumber: number }[];
    sequences: { periodKey: string; scopeKey: string; nextNumber: number }[];
}

/** One counter the chosen format draws from in the current period. */
export interface CounterRow {
    scopeKey: string;
    label: string;
    storeId: string | null;
    counterNumber: number | null;
    /** Where the counter stands now — the lowest "next number" it may be given. */
    currentNext: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

/**
 * The counters a format would draw from, in the same keys the server uses
 * (`numberingScopeKey` in the backend's document-number.utils).
 */
export function counterRowsFor(config: DocumentNumberingConfig, data: DocumentNumberingData): CounterRow[] {
    const periodKey = numberingPeriodKey(config.resetPolicy, data.today);
    const currentNext = (scopeKey: string) =>
        data.sequences.find((s) => s.periodKey === periodKey && s.scopeKey === scopeKey)?.nextNumber ?? 1;

    if (config.scope === 'TENANT') {
        return [{
            scopeKey: '',
            label: 'Whole business',
            storeId: data.stores[0]?.id ?? null,
            counterNumber: null,
            currentNext: currentNext(''),
        }];
    }

    if (config.scope === 'STORE') {
        return data.stores.map((store) => ({
            scopeKey: `store:${store.id}`,
            label: store.name,
            storeId: store.id,
            counterNumber: null,
            currentNext: currentNext(`store:${store.id}`),
        }));
    }

    return data.stores.flatMap((store) => [
        ...data.counters
            .filter((counter) => counter.storeId === store.id)
            .map((counter) => ({
                scopeKey: `counter:${counter.id}`,
                label: `${store.name} · ${counter.name}`,
                storeId: store.id,
                counterNumber: counter.counterNumber,
                currentNext: currentNext(`counter:${counter.id}`),
            })),
        {
            scopeKey: `store:${store.id}:none`,
            label: `${store.name} · No counter (back office)`,
            storeId: store.id,
            counterNumber: null,
            currentNext: currentNext(`store:${store.id}:none`),
        },
    ]);
}

/** "Fiscal year 2026–27", "October 2026" — the period the counters below belong to. */
export function periodLabel(config: DocumentNumberingConfig, today: { year: number; month: number }): string {
    switch (config.resetPolicy) {
        case 'FISCAL_YEAR': {
            const start = today.month >= 7 ? today.year : today.year - 1;
            return `Fiscal year ${start}–${String((start + 1) % 100).padStart(2, '0')}`;
        }
        case 'CALENDAR_YEAR':
            return `Year ${today.year}`;
        case 'MONTHLY':
            return `${MONTHS[today.month - 1]} ${today.year}`;
        default:
            return 'All time (never resets)';
    }
}

/** A sample of the number a counter would issue next, rendered with the codes being edited. */
export function previewNumber(
    config: DocumentNumberingConfig,
    row: CounterRow,
    seq: number,
    today: { year: number; month: number },
    codeFor: (storeId: string) => string,
): string {
    return renderDocumentNumber(config, seq, {
        ...today,
        storeCode: row.storeId ? codeFor(row.storeId) : null,
        counterNumber: row.counterNumber,
    });
}

/**
 * Inline errors for the branch codes being edited, keyed by store id: one that
 * cannot be printed, or one another branch already uses. Blank is fine for a
 * branch that has never had a code — the server assigns the next `S<n>` when
 * the format is saved — but an existing code cannot be cleared.
 */
export function storeCodeErrors(
    stores: { id: string; code: string | null }[],
    codes: Record<string, string>,
): Record<string, string> {
    const errors: Record<string, string> = {};
    const owners = new Map<string, string>();
    for (const store of stores) {
        const raw = codes[store.id] ?? '';
        if (!raw.trim()) {
            if (store.code) errors[store.id] = 'Enter a code.';
            continue;
        }
        const code = normalizeStoreCode(raw);
        if (!code) {
            errors[store.id] = 'Use 1–6 letters or digits.';
            continue;
        }
        const owner = owners.get(code);
        if (owner) {
            errors[store.id] = 'Already used by another branch.';
            continue;
        }
        owners.set(code, store.id);
    }
    return errors;
}
