import {
    ANOMALY_KINDS,
    AnomalyPlan,
    AnomalyRecorder,
    anomalyNote,
    anomalySpec,
    planAnomalies,
} from './anomalies';
import { Rng } from './rng';

describe('anomaly catalogue', () => {
    it('has no duplicate kinds', () => {
        const kinds = ANOMALY_KINDS.map((spec) => spec.kind);
        expect(new Set(kinds).size).toBe(kinds.length);
    });

    it('describes every kind well enough to demo it', () => {
        for (const spec of ANOMALY_KINDS) {
            expect(spec.label.length).toBeGreaterThan(0);
            expect(spec.hint.length).toBeGreaterThan(0);
            expect(spec.module.length).toBeGreaterThan(0);
            expect(spec.ratePerMonth).toBeGreaterThan(0);
            // Anomalies are exceptions, not the baseline. Anything firing more
            // than a few times a month stops standing out in a report.
            expect(spec.ratePerMonth).toBeLessThanOrEqual(3);
        }
    });

    it('tags the row it lands on with a readable note', () => {
        expect(anomalyNote('BELOW_COST_SALE')).toBe('Demo anomaly — sold below cost');
    });

    it('refuses an unknown kind rather than returning a blank spec', () => {
        expect(() => anomalySpec('NOT_A_KIND' as never)).toThrow(/Unknown demo anomaly kind/);
    });
});

describe('planAnomalies', () => {
    it('is deterministic for a given seed', () => {
        const first = planAnomalies(new Rng('seed-a'), 180);
        const second = planAnomalies(new Rng('seed-a'), 180);
        expect(first.size).toBe(second.size);
        for (let day = 0; day < 180; day++) {
            expect(first.forDay(day)).toEqual(second.forDay(day));
        }
    });

    it('schedules more over a longer window', () => {
        const short = planAnomalies(new Rng('seed-b'), 30);
        const long = planAnomalies(new Rng('seed-b'), 180);
        expect(long.size).toBeGreaterThan(short.size);
    });

    it('never schedules a day outside the window', () => {
        const plan = planAnomalies(new Rng('seed-c'), 45);
        for (let day = -5; day < 60; day++) {
            const kinds = plan.forDay(day);
            if (kinds.length > 0) {
                expect(day).toBeGreaterThanOrEqual(0);
                expect(day).toBeLessThan(45);
            }
        }
    });

    it('holds back kinds that need history behind them', () => {
        // STOCK_TAKE_VARIANCE cannot land on day 3 of a six-month window: there is
        // nothing to have miscounted yet.
        const plan = planAnomalies(new Rng('seed-d'), 180);
        for (let day = 0; day < anomalySpec('STOCK_TAKE_VARIANCE').minDayIndex; day++) {
            expect(plan.forDay(day)).not.toContain('STOCK_TAKE_VARIANCE');
        }
    });

    it('still plants something in a short window', () => {
        // A two-week demo dataset with no anomalies at all would defeat the point.
        const plans = ['a', 'b', 'c', 'd', 'e'].map((seed) => planAnomalies(new Rng(seed), 14));
        expect(plans.some((plan) => plan.size > 0)).toBe(true);
    });
});

describe('AnomalyPlan', () => {
    it('groups several kinds landing on one day', () => {
        const plan = new AnomalyPlan([
            { dayIndex: 4, kind: 'BELOW_COST_SALE' },
            { dayIndex: 4, kind: 'EXPENSE_SPIKE' },
            { dayIndex: 9, kind: 'LARGE_SHRINKAGE' },
        ]);
        expect(plan.forDay(4)).toEqual(['BELOW_COST_SALE', 'EXPENSE_SPIKE']);
        expect(plan.has(9, 'LARGE_SHRINKAGE')).toBe(true);
        expect(plan.has(9, 'BELOW_COST_SALE')).toBe(false);
        expect(plan.forDay(1)).toEqual([]);
        expect(plan.size).toBe(3);
    });
});

describe('AnomalyRecorder', () => {
    it('records the answer key in the order things happened', () => {
        const recorder = new AnomalyRecorder();
        recorder.record('BELOW_COST_SALE', {
            occurredAt: new Date('2026-03-11T12:00:00Z'),
            entity: 'Sale',
            entityId: 'sale-1',
            reference: 'D1-S00048',
            detail: 'Rice sold at ৳283.86 against a ৳360.00 cost.',
        });
        recorder.record('EXPENSE_SPIKE', {
            occurredAt: new Date('2026-04-04T12:00:00Z'),
            entity: 'ExpenseEntry',
            entityId: 'expense-1',
            detail: 'Utilities of ৳78143.00.',
        });

        const [first, second] = recorder.list();
        expect(recorder.count).toBe(2);
        expect(first.kind).toBe('BELOW_COST_SALE');
        expect(first.severity).toBe('high');
        expect(first.module).toBe('sales');
        expect(first.occurredAt).toBe('2026-03-11T12:00:00.000Z');
        expect(first.reference).toBe('D1-S00048');
        // The hint travels with the record so the UI never has to look it up.
        expect(first.hint).toBe(anomalySpec('BELOW_COST_SALE').hint);
        expect(second.reference).toBeUndefined();
        expect(recorder.countsByKind()).toEqual({ BELOW_COST_SALE: 1, EXPENSE_SPIKE: 1 });
    });
});
