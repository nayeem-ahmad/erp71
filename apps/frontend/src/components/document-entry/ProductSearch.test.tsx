import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { api } from '@/lib/api';
import ProductSearch from './ProductSearch';
import { clearRateHistoryCache, resetRateHistoryPartyOnly } from './RateHistory';

jest.mock('@/lib/api', () => ({
    api: { searchProductsByQuantity: jest.fn(), getProductRateHistory: jest.fn() },
}));

const COFFEE = {
    id: 'prod-1',
    name: 'Coffee Beans',
    sku: 'CB-001',
    price: '1250.00',
    stocks: [{ quantity: 4 }, { quantity: 2 }],
};

const HISTORY = {
    type: 'purchase' as const,
    forParty: [
        {
            documentId: 'pur-1',
            documentNumber: 'PUR-0451',
            date: '2026-08-12T00:00:00.000Z',
            partyId: 'sup-1',
            partyName: 'Rahim Traders',
            quantity: 10,
            rate: 1180,
            lineTotal: 11800,
        },
    ],
    recent: [],
    summary: { lastRate: 1180, avgRate: 1180, minRate: 1180, maxRate: 1180 },
};

/** Pick the product out of the dropdown, leaving it staged on the entry bar. */
async function stageCoffee() {
    fireEvent.focus(screen.getByLabelText('Product'));
    await screen.findByText('Coffee Beans');
    fireEvent.click(screen.getByText('Coffee Beans'));
    await waitFor(() => expect(screen.getByLabelText('Unit Cost')).not.toBeDisabled());
}

describe('ProductSearch entry bar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearRateHistoryCache();
        resetRateHistoryPartyOnly();
        (api.searchProductsByQuantity as jest.Mock).mockResolvedValue([COFFEE]);
        (api.getProductRateHistory as jest.Mock).mockResolvedValue(HISTORY);
    });

    it('keeps the amount fields inert until a product is picked', () => {
        render(<ProductSearch onProductSelect={jest.fn()} priceLabel="Unit Cost" historyType="purchase" />);

        expect(screen.getByLabelText('Unit Cost')).toBeDisabled();
        expect(screen.getByLabelText('Qty')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
        expect(screen.getByLabelText('Previous rates')).toBeDisabled();
    });

    it('keeps the result list out of the entry form, where the table cannot cover it', async () => {
        render(
            <form data-testid="entry-form">
                <ProductSearch onProductSelect={jest.fn()} priceLabel="Unit Cost" />
                <div>Line items table</div>
            </form>,
        );

        fireEvent.focus(screen.getByLabelText('Product'));
        const option = await screen.findByText('Coffee Beans');

        expect(screen.getByTestId('entry-form')).not.toContainElement(option);
        expect(document.body).toContainElement(option);
    });

    it('shows the picked product in the same box the search used', async () => {
        render(<ProductSearch onProductSelect={jest.fn()} priceLabel="Unit Cost" />);
        await stageCoffee();

        const productBox = screen.getByLabelText('Product') as HTMLInputElement;
        expect(productBox.value).toBe('Coffee Beans');
        expect(productBox).toHaveAttribute('readOnly');
        expect(screen.getByLabelText('Unit Cost')).toHaveValue(1250);
    });

    it('adds the line with the edited cost and quantity', async () => {
        const onProductSelect = jest.fn();
        render(<ProductSearch onProductSelect={onProductSelect} priceLabel="Unit Cost" />);
        await stageCoffee();

        fireEvent.change(screen.getByLabelText('Unit Cost'), { target: { value: '1190' } });
        fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(onProductSelect).toHaveBeenCalledWith(
            COFFEE,
            { quantity: 3, price: 1190, availableQty: 6 },
        );
    });

    it('opens the history under the product box and adopts the rate that is clicked', async () => {
        render(
            <ProductSearch
                onProductSelect={jest.fn()}
                priceLabel="Unit Cost"
                historyType="purchase"
                historyPartyId="sup-1"
                historyPartyName="Rahim Traders"
            />,
        );
        await stageCoffee();

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Previous rates'));

        const panel = await screen.findByRole('dialog');
        // The header carries the comparison basis: which product, whose rates.
        expect(panel).toHaveTextContent('Previous purchase rates');
        expect(panel).toHaveTextContent('Coffee Beans · Rahim Traders');
        // The panel supplies the title, so its own body must not repeat it —
        // the inline panel under the bar carries the only other copy.
        expect(within(panel).getAllByText(/Previous purchase rates/i)).toHaveLength(1);

        fireEvent.click(within(panel).getByTitle('Use this rate'));

        // Picking is a decision — the panel closes and the cost is adopted.
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByLabelText('Unit Cost')).toHaveValue(1180);
    });

    it('has the history loaded before the panel is opened', async () => {
        render(
            <ProductSearch
                onProductSelect={jest.fn()}
                priceLabel="Unit Cost"
                historyType="purchase"
                historyPartyId="sup-1"
            />,
        );
        await stageCoffee();

        // Staging the product warms the cache, so the panel opens on rows
        // rather than on "Loading previous rates…".
        await waitFor(() => expect(api.getProductRateHistory).toHaveBeenCalled());
        fireEvent.click(screen.getByLabelText('Previous rates'));

        const panel = screen.getByRole('dialog');
        expect(within(panel).getByText('Rahim Traders')).toBeInTheDocument();
        expect(screen.queryByText(/Loading previous rates/i)).not.toBeInTheDocument();
        // The warm cache answers the second reader — no repeat round trip.
        expect(api.getProductRateHistory).toHaveBeenCalledTimes(1);
    });

    it('offers no history control at all when the document did not ask for one', async () => {
        render(<ProductSearch onProductSelect={jest.fn()} priceLabel="Unit Cost" />);
        await stageCoffee();

        expect(screen.queryByLabelText('Previous rates')).not.toBeInTheDocument();
        expect(api.getProductRateHistory).not.toHaveBeenCalled();
    });

    it('clearing the product closes its history and reopens the search', async () => {
        render(<ProductSearch onProductSelect={jest.fn()} priceLabel="Unit Cost" historyType="purchase" />);
        await stageCoffee();
        fireEvent.click(screen.getByLabelText('Previous rates'));
        await screen.findByRole('dialog');

        fireEvent.click(screen.getByLabelText('Clear product'));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Product')).not.toHaveAttribute('readOnly');
        expect(screen.getByLabelText('Unit Cost')).toBeDisabled();
    });
    it('shows the recent rates under the bar as soon as a product is picked', async () => {
        render(
            <ProductSearch
                onProductSelect={jest.fn()}
                priceLabel="Unit Cost"
                historyType="purchase"
                historyPartyId="sup-1"
                historyPartyName="Rahim Traders"
            />,
        );

        // Nothing staged yet — the bar carries no history of its own.
        expect(screen.queryByTestId('inline-rate-history')).not.toBeInTheDocument();

        await stageCoffee();

        // No click on the icon: the rates are simply there, under the bar.
        const inline = await screen.findByTestId('inline-rate-history');
        expect(inline).toHaveTextContent('Rahim Traders');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('adopts a rate clicked in the inline panel', async () => {
        render(
            <ProductSearch
                onProductSelect={jest.fn()}
                priceLabel="Unit Cost"
                historyType="purchase"
                historyPartyId="sup-1"
            />,
        );
        await stageCoffee();
        await screen.findByTestId('inline-rate-history');

        fireEvent.click(screen.getByTitle('Use this rate'));

        expect(screen.getByLabelText('Unit Cost')).toHaveValue(1180);
    });

    it('takes the inline panel away with the product', async () => {
        render(<ProductSearch onProductSelect={jest.fn()} priceLabel="Unit Cost" historyType="purchase" />);
        await stageCoffee();
        await screen.findByTestId('inline-rate-history');

        fireEvent.click(screen.getByLabelText('Clear product'));

        expect(screen.queryByTestId('inline-rate-history')).not.toBeInTheDocument();
    });

    it('keeps the icon and its full panel alongside the inline rates', async () => {
        render(
            <ProductSearch
                onProductSelect={jest.fn()}
                priceLabel="Unit Cost"
                historyType="purchase"
                historyPartyId="sup-1"
                historyPartyName="Rahim Traders"
            />,
        );
        await stageCoffee();
        await screen.findByTestId('inline-rate-history');

        fireEvent.click(screen.getByLabelText('Previous rates'));

        expect(await screen.findByRole('dialog')).toHaveTextContent('Previous purchase rates');
    });

    it('offers no inline rates when the document did not ask for history', async () => {
        render(<ProductSearch onProductSelect={jest.fn()} priceLabel="Unit Cost" />);
        await stageCoffee();

        expect(screen.queryByTestId('inline-rate-history')).not.toBeInTheDocument();
    });
});
