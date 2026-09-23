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

    it('adds the flat costs after the discount, whichever unit was typed', () => {
        const byPercent = computeSaleTotals(
            CART,
            { ...EMPTY_ADJUSTMENTS, discountPercent: 10, transportCost: 50, laborCost: 20, rounding: -0.5 },
            0,
        );
        const byAmount = computeSaleTotals(
            CART,
            { ...EMPTY_ADJUSTMENTS, discountMode: 'AMOUNT', discountAmount: 100, transportCost: 50, laborCost: 20, rounding: -0.5 },
            0,
        );

        expect(byPercent.total).toBe(969.5);
        expect(byAmount.total).toBe(byPercent.total);
    });
});

describe('computeSaleTotals — VAT', () => {
    it('reports the VAT inside tax-inclusive prices without adding it to the total', () => {
        // The server treats `price_at_sale` as tax-inclusive and rejects any
        // total that adds VAT on top, so the screen must not add it either.
        const totals = computeSaleTotals(CART, EMPTY_ADJUSTMENTS, 15);

        expect(totals.total).toBe(1000);
        expect(totals.vat).toBe(130.43);
    });

    it('leaves transport out of the VAT, as the server snapshot does', () => {
        const totals = computeSaleTotals(CART, { ...EMPTY_ADJUSTMENTS, transportCost: 50 }, 15);

        expect(totals.total).toBe(1050);
        expect(totals.vat).toBe(130.43);
    });

    it('declares VAT on the discounted amount', () => {
        const totals = computeSaleTotals(CART, { ...EMPTY_ADJUSTMENTS, discountPercent: 10 }, 15);

        expect(totals.total).toBe(900);
        expect(totals.vat).toBe(117.39);
    });

    it("prefers a line's own product rate over the workspace default", () => {
        const exempt = { ...line(500, 2), vatRate: 0 };

        expect(computeSaleTotals([exempt], EMPTY_ADJUSTMENTS, 15).vat).toBe(0);
    });
});

describe('computeSaleTotals — line discounts', () => {
    it('builds the subtotal and total from the discounted line totals', () => {
        // The reported bug: ৳380 at 10% shows ৳342 on the line, so it must
        // bill ৳342 too.
        const totals = computeSaleTotals([{ ...line(380, 1), discount: 10 }], EMPTY_ADJUSTMENTS, 0);

        expect(totals.subtotal).toBe(342);
        expect(totals.total).toBe(342);
    });

    it('takes the invoice discount off the already-discounted lines', () => {
        const totals = computeSaleTotals(
            [{ ...line(380, 1), discount: 10 }, line(100, 1)],
            { ...EMPTY_ADJUSTMENTS, discountPercent: 10 },
            0,
        );

        expect(totals.subtotal).toBe(442);
        expect(totals.discount).toBeCloseTo(44.2, 10);
        expect(totals.total).toBeCloseTo(397.8, 10);
    });

    it('rounds the net unit price to the paisa, as the server stores it', () => {
        // 99.99 less 7% is 92.9907; the server keeps 92.99, so 3 units are 278.97.
        const totals = computeSaleTotals([{ ...line(99.99, 3), discount: 7 }], EMPTY_ADJUSTMENTS, 0);

        expect(totals.subtotal).toBeCloseTo(278.97, 10);
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

describe('TotalsFooter — VAT row', () => {
    it('shows the VAT as contained in the total, not as a charge above it', () => {
        render(
            <TotalsFooter
                totals={computeSaleTotals(CART, EMPTY_ADJUSTMENTS, 15)}
                onTotalsChange={jest.fn()}
                tenantVatRate={15}
            />,
        );

        expect(screen.getByText('Incl. VAT')).toBeInTheDocument();
        expect(screen.getByText('৳130.43')).toBeInTheDocument();
        // Subtotal and total are the same figure: nothing was added for VAT.
        expect(screen.getAllByText('৳1000.00')).toHaveLength(2);
    });

    it('leaves the row out when the sale carries no VAT', () => {
        render(<TotalsFooter totals={totalsFor({})} onTotalsChange={jest.fn()} tenantVatRate={0} />);

        expect(screen.queryByText('Incl. VAT')).not.toBeInTheDocument();
    });
});
