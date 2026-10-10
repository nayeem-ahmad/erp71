import { allocateOldestFirst, allocationTotal, allocationsToSend } from './bill-allocation';
import type { OpenBill } from './types';

const bill = (id: string, balance_due: number): OpenBill => ({
    id,
    purchase_number: id.toUpperCase(),
    total_amount: balance_due,
    paid_amount: 0,
    balance_due,
    payment_status: 'UNPAID',
});

const bills = [bill('p1', 8000), bill('p2', 20000), bill('p3', 14800)];

describe('allocateOldestFirst', () => {
    it('fills each bill in turn until the money runs out', () => {
        expect(allocateOldestFirst(bills, 30000)).toEqual({ p1: '8000', p2: '20000', p3: '2000' });
    });

    it('leaves later bills empty when the money covers only the first', () => {
        expect(allocateOldestFirst(bills, 5000)).toEqual({ p1: '5000', p2: '', p3: '' });
    });

    it('never puts more on a bill than it owes, leaving the rest unallocated', () => {
        expect(allocateOldestFirst(bills, 50000)).toEqual({ p1: '8000', p2: '20000', p3: '14800' });
    });

    it('keeps paisa exact', () => {
        expect(allocateOldestFirst([bill('a', 100.1), bill('b', 50)], 100.3)).toEqual({ a: '100.1', b: '0.2' });
    });

    it('allocates nothing for nothing', () => {
        expect(allocateOldestFirst(bills, 0)).toEqual({ p1: '', p2: '', p3: '' });
    });
});

describe('allocationTotal / allocationsToSend', () => {
    const allocations = { p1: '8000', p2: '1500.5', p3: '', p4: 'abc' };

    it('sums what was typed, ignoring blanks and junk', () => {
        expect(allocationTotal(allocations)).toBe(9500.5);
    });

    it('sends only the bills that get something', () => {
        expect(allocationsToSend(allocations)).toEqual([
            { purchaseId: 'p1', amount: 8000 },
            { purchaseId: 'p2', amount: 1500.5 },
        ]);
    });
});
