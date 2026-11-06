import { marginBand, sumMarginRows } from './gross-profit';

const coverage = (costedRevenue: number, costedLines: number) => ({
    costedLines,
    uncostedLines: 0,
    costedRevenue,
    uncostedRevenue: 0,
    costedRevenuePct: 100,
});

describe('gross-profit helpers', () => {
    it('bands a margin as the cells colour it, and no margin as no cost', () => {
        expect(marginBand(-3)).toBe('loss');
        expect(marginBand(0)).toBe('thin');
        expect(marginBand(9.9)).toBe('thin');
        expect(marginBand(10)).toBe('healthy');
        expect(marginBand(null)).toBe('noCost');
    });

    it('adds rows up the way the server does: margin over the revenue that has a cost', () => {
        const totals = sumMarginRows([
            { revenue: 1000, cogs: 800, grossProfit: 200, coverage: coverage(1000, 2) },
            // Sold without a cost on file: revenue counts, profit and margin do not.
            { revenue: 500, cogs: 0, grossProfit: null, coverage: coverage(0, 0) },
        ]);
        expect(totals).toEqual({ revenue: 1500, cogs: 800, grossProfit: 200, grossMarginPct: 20 });
    });

    it('says nothing rather than zero when no row has a cost', () => {
        expect(sumMarginRows([{ revenue: 500, cogs: 0, grossProfit: null, coverage: coverage(0, 0) }])).toMatchObject({
            grossProfit: null,
            grossMarginPct: null,
        });
    });
});
