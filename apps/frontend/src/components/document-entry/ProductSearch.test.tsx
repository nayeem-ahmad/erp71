import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import ProductSearch from './ProductSearch';
import { clearRateHistoryCache } from './RateHistory';

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
        // The panel supplies the title, so the body must not repeat it.
        expect(screen.getAllByText(/Previous purchase rates/i)).toHaveLength(1);

        fireEvent.click(await screen.findByTitle('Use this rate'));

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

        expect(screen.getByText('Rahim Traders')).toBeInTheDocument();
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
});
