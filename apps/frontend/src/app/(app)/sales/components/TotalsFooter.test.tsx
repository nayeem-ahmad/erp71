import { render, screen, fireEvent } from '@testing-library/react';
import TotalsFooter from './TotalsFooter';
import { computeSaleTotals, EMPTY_ADJUSTMENTS, NO_VAT_PRICING, type SaleAdjustments } from './SaleEntryLayout';
import type { LineItem } from '@/lib/hooks/useNewSaleCart';

const line = (price: number, quantity: number): LineItem => ({
    productId: `p-${price}-${quantity}`,
    name: 'Widget',
    price,
    quantity,
    discount: 0,
});

/** A shop that prices before VAT and adds 15% on top. */
const ON_TOP_15 = { defaultVatRate: 15, pricesIncludeVat: false };
/** A shop whose prices include 15% VAT — the default. */
const INCLUDED_15 = { defaultVatRate: 15, pricesIncludeVat: true };

/** One ৳1,000 cart, so a 10% discount and a ৳100 one are the same money. */
const CART = [line(500, 2)];

const totalsFor = (adjustments: Partial<SaleAdjustments>, items: LineItem[] = CART) =>
    computeSaleTotals(items, { ...EMPTY_ADJUSTMENTS, ...adjustments }, NO_VAT_PRICING);

describe('computeSaleTotals — how the shop prices VAT', () => {
    it('shows the VAT inside VAT-inclusive prices without adding it', () => {
        const totals = computeSaleTotals([line(1150, 1)], EMPTY_ADJUSTMENTS, INCLUDED_15);

        expect(totals.vatIncluded).toBe(true);
        expect(totals.vat).toBe(150);
        expect(totals.total).toBe(1150);
        expect(totals.postedUnitPrices).toEqual([1150]);
    });

    it('adds VAT on top of before-VAT prices and posts them VAT-inclusive', () => {
        const totals = computeSaleTotals([line(1000, 1)], EMPTY_ADJUSTMENTS, ON_TOP_15);

        expect(totals.vatIncluded).toBe(false);
        expect(totals.subtotal).toBe(1000);
        expect(totals.vat).toBe(150);
        expect(totals.total).toBe(1150);
        expect(totals.postedUnitPrices).toEqual([1150]);
    });

    it('posts the discount in the same VAT-inclusive terms as the prices', () => {
        const totals = computeSaleTotals(
            [line(6040, 1)],
            { ...EMPTY_ADJUSTMENTS, discountMode: 'AMOUNT', discountAmount: 10 },
            ON_TOP_15,
        );

        expect(totals.discountShown).toBe(10);
        expect(totals.postedDiscount).toBe(11.5);
        expect(totals.vat).toBe(904.5);
        expect(totals.total).toBe(6934.5);
    });

    it('taxes each line at its product\u2019s own rate, falling back to the shop default', () => {
        const zeroRated: LineItem = { ...line(1000, 1), productId: 'zero', vatRate: 0 };
        const totals = computeSaleTotals([line(1000, 1), zeroRated], EMPTY_ADJUSTMENTS, ON_TOP_15);

        expect(totals.postedUnitPrices).toEqual([1150, 1000]);
        expect(totals.vat).toBe(150);
        // Two rates in the sale: the label cannot name one.
        expect(totals.vatRate).toBeNull();
    });

    it('carries supplementary duty under the VAT', () => {
        const withSd: LineItem = { ...line(1000, 1), sdRate: 10 };
        const totals = computeSaleTotals([withSd], EMPTY_ADJUSTMENTS, ON_TOP_15);

        expect(totals.sd).toBe(100);
        expect(totals.vat).toBe(165);
        expect(totals.total).toBe(1265);
    });
});

describe('TotalsFooter — the VAT row', () => {
    const renderFooter = (totals: ReturnType<typeof computeSaleTotals>) =>
        render(<TotalsFooter totals={totals} onTotalsChange={() => {}} tenantVatRate={15} />);

    it('says the VAT is included when it is inside the prices', () => {
        renderFooter(computeSaleTotals([line(1150, 1)], EMPTY_ADJUSTMENTS, INCLUDED_15));

        expect(screen.getByText('VAT 15% (included)')).toBeInTheDocument();
        expect(screen.getByText('৳150.00')).toBeInTheDocument();
    });

    it('names the rate as part of the sum when VAT is added on top', () => {
        renderFooter(computeSaleTotals([line(1000, 1)], EMPTY_ADJUSTMENTS, ON_TOP_15));

        expect(screen.getByText('VAT (15%)')).toBeInTheDocument();
        expect(screen.getByText('৳1150.00')).toBeInTheDocument();
    });

    it('shows VAT added on top even on a document without adjustment rows', () => {
        render(
            <TotalsFooter
                totals={computeSaleTotals([line(1000, 1)], EMPTY_ADJUSTMENTS, ON_TOP_15)}
                onTotalsChange={() => {}}
                tenantVatRate={15}
                showAdjustments={false}
            />,
        );

        expect(screen.getByText('VAT (15%)')).toBeInTheDocument();
    });
});

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
            ON_TOP_15,
        );
        const byAmount = computeSaleTotals(
            CART,
            { ...EMPTY_ADJUSTMENTS, discountMode: 'AMOUNT', discountAmount: 100, transportCost: 50 },
            ON_TOP_15,
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

describe('TotalsFooter — customer dues', () => {
    /** The ৳1,000 cart, read-only, for a customer with the given dues. */
    const renderDues = (previousDue: number | null | undefined, amountPaid?: number) =>
        render(
            <TotalsFooter
                totals={totalsFor({})}
                onTotalsChange={jest.fn()}
                tenantVatRate={0}
                previousDue={previousDue}
                amountPaid={amountPaid}
                readOnly
            />,
        );

    /** The amount printed beside a label, e.g. "Total Due" → "৳900.00". */
    const amountBeside = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

    it('adds what this sale leaves unpaid to what was owed before it', () => {
        renderDues(500, 600);

        expect(amountBeside('Previous Due')).toBe('৳500.00');
        expect(amountBeside('Total Due')).toBe('৳900.00');
    });

    it('carries the previous due alone when the sale is paid in full', () => {
        renderDues(500, 1000);

        expect(amountBeside('Total Due')).toBe('৳500.00');
    });

    it('shows an advance as a negative previous due that the sale draws down', () => {
        renderDues(-300, 0);

        expect(amountBeside('Previous Due')).toBe('৳-300.00');
        expect(amountBeside('Total Due')).toBe('৳700.00');
    });

    it('stays out of the way when the customer owed nothing before', () => {
        // The payment strip already says what this sale leaves unpaid.
        renderDues(0, 600);

        expect(screen.queryByText('Previous Due')).not.toBeInTheDocument();
        expect(screen.queryByText('Total Due')).not.toBeInTheDocument();
    });

    it('takes what is paid beyond the sale off the previous due', () => {
        renderDues(500, 1800);

        expect(amountBeside('Previous Due')).toBe('৳500.00');
        expect(amountBeside('Total Due')).toBe('৳-300.00');
    });

    it('shows the advance an overpayment leaves when nothing was owed before', () => {
        renderDues(0, 1200);

        expect(amountBeside('Previous Due')).toBe('৳0.00');
        expect(amountBeside('Total Due')).toBe('৳-200.00');
    });

    it('shows nothing without a customer', () => {
        renderDues(null, 600);

        expect(screen.queryByText('Previous Due')).not.toBeInTheDocument();
    });

    it('shows the previous due alone to a screen with no payments to add', () => {
        renderDues(500);

        expect(amountBeside('Previous Due')).toBe('৳500.00');
        expect(screen.queryByText('Total Due')).not.toBeInTheDocument();
    });
});
