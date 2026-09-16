import { render, screen, fireEvent } from '@testing-library/react';
import TotalsFooter from './TotalsFooter';
import { computeSaleTotals, EMPTY_ADJUSTMENTS, type SaleAdjustments } from './SaleEntryLayout';
import type { LineItem } from '@/lib/hooks/useNewSaleCart';

const line = (price: number, quantity: number): LineItem => ({
    productId: `p-${price}-${quantity}`,
    name: 'Widget',
    price,
    quantity,
    discount: 0,
});

/** One ৳1,000 cart, so a 10% discount and a ৳100 one are the same money. */
const CART = [line(500, 2)];

const totalsFor = (adjustments: Partial<SaleAdjustments>, items: LineItem[] = CART) =>
    computeSaleTotals(items, { ...EMPTY_ADJUSTMENTS, ...adjustments }, 0);

describe('computeSaleTotals — overall discount', () => {
    it('derives the taka from the percentage in PERCENT mode', () => {
        const totals = totalsFor({ discountPercent: 10 });

        expect(totals.discount).toBe(100);
        expect(totals.discountPercent).toBe(10);
        expect(totals.total).toBe(900);
    });

    it('derives the percentage from the taka in AMOUNT mode', () => {
        const totals = totalsFor({ discountMode: 'AMOUNT', discountAmount: 250 });

        expect(totals.discount).toBe(250);
        expect(totals.discountPercent).toBe(25);
        expect(totals.total).toBe(750);
    });

    it('ignores the stale percentage left behind by a switch to AMOUNT', () => {
        const totals = totalsFor({
            discountMode: 'AMOUNT',
            discountAmount: 100,
            discountPercent: 90,
        });

        expect(totals.discount).toBe(100);
        expect(totals.discountPercent).toBe(10);
    });

    it('caps a flat discount at the subtotal rather than inverting the invoice', () => {
        const totals = totalsFor({ discountMode: 'AMOUNT', discountAmount: 5000 });

        expect(totals.discount).toBe(1000);
        expect(totals.discountPercent).toBe(100);
        expect(totals.total).toBe(0);
    });

    it('reports no percentage on an empty cart instead of dividing by zero', () => {
        const totals = totalsFor({ discountMode: 'AMOUNT', discountAmount: 50 }, []);

        expect(totals.discount).toBe(0);
        expect(totals.discountPercent).toBe(0);
        expect(totals.total).toBe(0);
    });

    it('takes VAT and the flat costs on the discounted amount, whichever unit was typed', () => {
        const byPercent = computeSaleTotals(
            CART,
            { ...EMPTY_ADJUSTMENTS, discountPercent: 10, transportCost: 50 },
            15,
        );
        const byAmount = computeSaleTotals(
            CART,
            { ...EMPTY_ADJUSTMENTS, discountMode: 'AMOUNT', discountAmount: 100, transportCost: 50 },
            15,
        );

        expect(byPercent.vat).toBe(135);
        expect(byPercent.total).toBe(1085);
        expect(byAmount).toEqual(expect.objectContaining({
            vat: byPercent.vat,
            total: byPercent.total,
        }));
    });
});

describe('TotalsFooter — discount unit toggle', () => {
    const renderFooter = (adjustments: Partial<SaleAdjustments>, onTotalsChange = jest.fn()) => {
        render(
            <TotalsFooter
                totals={totalsFor(adjustments)}
                onTotalsChange={onTotalsChange}
                tenantVatRate={0}
            />,
        );
        return onTotalsChange;
    };

    it('starts on percentage and shows the taka it comes to', () => {
        renderFooter({ discountPercent: 10 });

        expect(screen.getByLabelText('Discount percent')).toHaveValue(10);
        expect(screen.queryByLabelText('Discount amount')).not.toBeInTheDocument();
        expect(screen.getByText('-৳100.00')).toBeInTheDocument();
    });

    it('swaps to a taka field and shows the calculated percentage', () => {
        renderFooter({ discountMode: 'AMOUNT', discountAmount: 250 });

        expect(screen.getByLabelText('Discount amount')).toHaveValue(250);
        expect(screen.queryByLabelText('Discount percent')).not.toBeInTheDocument();
        expect(screen.getByText('25.00%')).toBeInTheDocument();
    });

    it('carries the discount across a switch to taka', () => {
        const onTotalsChange = renderFooter({ discountPercent: 10 });

        fireEvent.click(screen.getByTitle('Discount by amount'));

        expect(onTotalsChange).toHaveBeenCalledWith({
            discountMode: 'AMOUNT',
            discountAmount: 100,
        });
    });

    it('carries the calculated percentage back when switching to %', () => {
        const onTotalsChange = renderFooter({ discountMode: 'AMOUNT', discountAmount: 250 });

        fireEvent.click(screen.getByTitle('Discount by percentage'));

        expect(onTotalsChange).toHaveBeenCalledWith({
            discountMode: 'PERCENT',
            discountPercent: 25,
        });
    });

    it('leaves the figure alone when the active unit is clicked again', () => {
        const onTotalsChange = renderFooter({ discountPercent: 10 });

        fireEvent.click(screen.getByTitle('Discount by percentage'));

        expect(onTotalsChange).not.toHaveBeenCalled();
    });

    it('reports a typed amount as a patch, not a percentage', () => {
        const onTotalsChange = renderFooter({ discountMode: 'AMOUNT', discountAmount: 0 });

        fireEvent.change(screen.getByLabelText('Discount amount'), { target: { value: '75.5' } });

        expect(onTotalsChange).toHaveBeenCalledWith({ discountAmount: 75.5 });
    });

    it('says so when a flat discount exceeds the subtotal', () => {
        renderFooter({ discountMode: 'AMOUNT', discountAmount: 5000 });

        expect(screen.getByText('Capped at the ৳1000.00 subtotal.')).toBeInTheDocument();
    });

    it('names the percentage on a posted sale read back in read-only mode', () => {
        render(
            <TotalsFooter
                totals={totalsFor({ discountMode: 'AMOUNT', discountAmount: 250 })}
                onTotalsChange={jest.fn()}
                tenantVatRate={0}
                readOnly
            />,
        );

        expect(screen.getByText('Discount (25.00%)')).toBeInTheDocument();
        // Read-only rows are signed inside the amount formatter, as they were
        // before the unit toggle existed.
        expect(screen.getByText('৳-250.00')).toBeInTheDocument();
    });
});
