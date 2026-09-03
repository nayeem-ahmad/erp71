import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import LineItemsTable from './LineItemsTable';
import { clearRateHistoryCache } from './RateHistory';
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
