import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import LineItemsTable from './LineItemsTable';
import { clearRateHistoryCache } from './RateHistory';
import { resetDocumentLineColumnWidths } from './useColumnWidths';
import type { LineItem } from '@/lib/hooks/useNewSaleCart';

jest.mock('@/lib/api', () => ({
    api: { getProductRateHistory: jest.fn() },
}));

const ITEM: LineItem = {
    productId: 'prod-1',
    name: 'Coffee Beans',
    price: 1250,
    quantity: 2,
    discount: 0,
    availableQty: 6,
};

const HISTORY = {
    type: 'purchase' as const,
    forParty: [],
    recent: [
        {
            documentId: 'pur-1',
            documentNumber: 'PUR-0451',
            date: '2026-08-12T00:00:00.000Z',
            partyId: 'sup-2',
            partyName: 'Karim Store',
            quantity: 10,
            rate: 1180,
            lineTotal: 11800,
        },
    ],
    summary: { lastRate: 1180, avgRate: 1180, minRate: 1180, maxRate: 1180 },
};

describe('LineItemsTable rate history', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearRateHistoryCache();
        (api.getProductRateHistory as jest.Mock).mockResolvedValue(HISTORY);
    });

    it('opens the history for one line and writes the picked rate back to it', async () => {
        const onUpdateItem = jest.fn();
        render(
            <LineItemsTable
                items={[ITEM]}
                onUpdateItem={onUpdateItem}
                onRemoveItem={jest.fn()}
                historyType="purchase"
                historyPartyName="Rahim Traders"
            />,
        );

        fireEvent.click(screen.getByLabelText('Previous rates for Coffee Beans'));
        expect(await screen.findByRole('dialog')).toHaveTextContent('Previous purchase rates');

        fireEvent.click(await screen.findByTitle('Use this rate'));

        expect(onUpdateItem).toHaveBeenCalledWith('prod-1', { price: 1180 });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('offers no history where the price is frozen — there is nothing to adopt into', () => {
        render(
            <LineItemsTable
                items={[ITEM]}
                onUpdateItem={jest.fn()}
                onRemoveItem={jest.fn()}
                readOnlyPrice
                historyType="purchase"
            />,
        );

        expect(screen.queryByLabelText('Previous rates for Coffee Beans')).not.toBeInTheDocument();
    });

    it('offers no history on a document that did not ask for it', () => {
        render(<LineItemsTable items={[ITEM]} onUpdateItem={jest.fn()} onRemoveItem={jest.fn()} />);

        expect(screen.queryByLabelText('Previous rates for Coffee Beans')).not.toBeInTheDocument();
        expect(api.getProductRateHistory).not.toHaveBeenCalled();
    });
});

const GROUPED: LineItem = {
    ...ITEM,
    group: 'Groceries',
    subgroup: 'Cooking Oil',
};

function renderTable(props: Partial<React.ComponentProps<typeof LineItemsTable>> = {}) {
    return render(
        <LineItemsTable
            items={[GROUPED]}
            onUpdateItem={jest.fn()}
            onRemoveItem={jest.fn()}
            {...props}
        />,
    );
}

describe('LineItemsTable — group under the name', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetDocumentLineColumnWidths();
    });

    it('prints the group beneath the product rather than in its own column', () => {
        renderTable();

        // Visible at every width — the old Group column was `hidden md:table-cell`,
        // so a phone or tablet never showed it at all.
        expect(screen.getByText('Groceries → Cooking Oil')).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: /^group$/i })).not.toBeInTheDocument();
    });

    it('falls back to the group alone when the product has no subgroup', () => {
        renderTable({ items: [{ ...GROUPED, subgroup: undefined }] });

        expect(screen.getByText('Groceries')).toBeInTheDocument();
    });

    it('prints nothing where the product is ungrouped, rather than a stray arrow', () => {
        renderTable({ items: [ITEM] });

        expect(screen.queryByText(/→/)).not.toBeInTheDocument();
        expect(screen.getByText('Coffee Beans')).toBeInTheDocument();
    });
});

describe('LineItemsTable — number fields', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetDocumentLineColumnWidths();
    });

    it('gives the amounts room and drops the spinners that were eating it', () => {
        renderTable();

        const price = screen.getByLabelText('Price — Coffee Beans');
        const qty = screen.getByLabelText('Qty — Coffee Beans');
        const disc = screen.getByLabelText('Disc % — Coffee Beans');

        // The native up/down arrows sit *inside* the box and cost ~16px of it,
        // which is what clipped a five-figure amount.
        for (const field of [price, qty, disc]) {
            expect(field.className).toContain('no-spinner');
        }
        expect(price.className).toContain('w-28');
        expect(disc.className).toContain('w-[4.5rem]');
        expect(qty.className).toContain('w-16');
    });
});

describe('LineItemsTable — resizable columns', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetDocumentLineColumnWidths();
    });

    it('offers a drag handle on every column heading', () => {
        renderTable();

        const handles = screen.getAllByRole('separator');
        expect(handles.length).toBeGreaterThan(0);
        expect(handles[0]).toHaveAttribute('aria-label', expect.stringMatching(/resize/i));
    });

    it('remembers a dragged width across a remount', () => {
        const { unmount } = renderTable();

        const handle = screen.getByLabelText('Resize Price column');
        fireEvent.mouseDown(handle, { clientX: 100 });
        fireEvent.mouseMove(document, { clientX: 160 });
        fireEvent.mouseUp(document);

        const widened = screen.getByRole('columnheader', { name: /price/i });
        const width = widened.style.width;
        expect(width).toBeTruthy();

        unmount();
        renderTable();

        // Same shared setting, so the next document opens on the width the
        // operator dragged rather than the default.
        expect(screen.getByRole('columnheader', { name: /price/i }).style.width).toBe(width);
    });

    it('never lets a column be dragged narrower than the input inside it', () => {
        renderTable();

        const handle = screen.getByLabelText('Resize Price column');
        fireEvent.mouseDown(handle, { clientX: 300 });
        fireEvent.mouseMove(document, { clientX: 0 });
        fireEvent.mouseUp(document);

        const header = screen.getByRole('columnheader', { name: /price/i });
        expect(parseInt(header.style.width, 10)).toBeGreaterThanOrEqual(80);
    });

    it('hands the width back on a double-click', () => {
        renderTable();

        const handle = screen.getByLabelText('Resize Price column');
        fireEvent.mouseDown(handle, { clientX: 100 });
        fireEvent.mouseMove(document, { clientX: 200 });
        fireEvent.mouseUp(document);
        expect(screen.getByRole('columnheader', { name: /price/i }).style.width).toBeTruthy();

        fireEvent.doubleClick(handle);

        expect(screen.getByRole('columnheader', { name: /price/i }).style.width).toBe('');
    });

    it('keeps the reset out of the way until something has been customised', () => {
        renderTable();
        expect(screen.queryByRole('button', { name: /reset widths/i })).not.toBeInTheDocument();

        const handle = screen.getByLabelText('Resize Price column');
        fireEvent.mouseDown(handle, { clientX: 100 });
        fireEvent.mouseMove(document, { clientX: 200 });
        fireEvent.mouseUp(document);

        fireEvent.click(screen.getByRole('button', { name: /reset widths/i }));

        expect(screen.getByRole('columnheader', { name: /price/i }).style.width).toBe('');
        expect(screen.queryByRole('button', { name: /reset widths/i })).not.toBeInTheDocument();
    });
});
