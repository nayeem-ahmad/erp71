import { formatHistoryValue, humanizeHistoryPath, isEmptyHistoryValue, visibleEntries } from './record-history-format';

const fmtDate = (iso: string) => `D(${iso.slice(0, 10)})`;

describe('humanizeHistoryPath', () => {
    it('turns keyed lines and snake_case into readable segments', () => {
        expect(humanizeHistoryPath('items[Rice 5kg].price_at_sale')).toBe('items › Rice 5kg › price at sale');
        expect(humanizeHistoryPath('due_balance')).toBe('due balance');
    });

    it('keeps dots inside a line label', () => {
        expect(humanizeHistoryPath('items[Oil 1.5L].quantity')).toBe('items › Oil 1.5L › quantity');
    });
});

describe('formatHistoryValue', () => {
    it('renders empties as an empty string so the caller can label them', () => {
        expect(formatHistoryValue(null, fmtDate)).toBe('');
        expect(formatHistoryValue('', fmtDate)).toBe('');
        expect(isEmptyHistoryValue(undefined)).toBe(true);
    });

    it('formats ISO timestamps and leaves other strings alone', () => {
        expect(formatHistoryValue('2026-10-12T04:00:00.000Z', fmtDate)).toBe('D(2026-10-12)');
        expect(formatHistoryValue('INV-0001', fmtDate)).toBe('INV-0001');
    });

    it('renders numbers and booleans plainly', () => {
        expect(formatHistoryValue(1500.5, fmtDate)).toBe('1500.5');
        expect(formatHistoryValue(true, fmtDate)).toBe('✓');
    });

    it('flattens an added or removed line to its non-empty fields', () => {
        expect(formatHistoryValue({ product: 'Sugar', quantity: 1, warehouse: null }, fmtDate)).toBe(
            'product: Sugar · quantity: 1',
        );
    });

    it('names keyed lines in a list by their label', () => {
        expect(
            formatHistoryValue(
                [
                    { _key: 'p1', _label: 'Rice', quantity: 2 },
                    { _key: 'p2', _label: 'Oil', quantity: 1 },
                ],
                fmtDate,
            ),
        ).toBe('Rice, Oil');
    });
});

describe('visibleEntries', () => {
    it('drops bookkeeping keys', () => {
        expect(visibleEntries({ _key: 'k', _label: 'L', name: 'x' })).toEqual([['name', 'x']]);
    });
});
