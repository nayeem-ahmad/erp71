import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { api } from '@/lib/api';
import RateHistory, { clearRateHistoryCache } from './RateHistory';

jest.mock('@/lib/api', () => ({
    api: { getProductRateHistory: jest.fn() },
}));

const PURCHASE_HISTORY = {
    type: 'purchase' as const,
    forParty: [
        {
            documentId: 'pur-1',
            documentNumber: 'PUR-0451',
            date: '2026-08-12T00:00:00.000Z',
            partyId: 'sup-1',
            partyName: 'Rahim Traders',
            quantity: 10,
            rate: 1250,
            lineTotal: 12500,
        },
    ],
    recent: [
        {
            documentId: 'pur-2',
            documentNumber: 'PUR-0442',
            date: '2026-08-03T00:00:00.000Z',
            partyId: null,
            partyName: null,
            quantity: 5,
            rate: 1300,
            lineTotal: 6500,
        },
    ],
    summary: { lastRate: 1250, avgRate: 1275, minRate: 1250, maxRate: 1300 },
};

describe('RateHistory', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearRateHistoryCache();
        (api.getProductRateHistory as jest.Mock).mockResolvedValue(PURCHASE_HISTORY);
    });

    it('shows each past rate against the party that traded it', async () => {
        render(<RateHistory productId="prod-1" type="purchase" partyId="sup-1" partyName="Rahim Traders" />);

        await waitFor(() => expect(screen.getByText(/Previous purchase rates/i)).toBeInTheDocument());

        // The selected supplier heads the list; the supplier-less purchase is
        // labelled rather than dropped.
        expect(screen.getAllByText('Rahim Traders').length).toBeGreaterThan(0);
        expect(screen.getByText('No supplier')).toBeInTheDocument();
        expect(screen.getByText('×10')).toBeInTheDocument();
        expect(screen.getByText('Other suppliers')).toBeInTheDocument();
    });

    it('adopts a rate when it is clicked', async () => {
        const onPickRate = jest.fn();
        render(<RateHistory productId="prod-1" type="purchase" onPickRate={onPickRate} />);

        const rates = await screen.findAllByTitle('Use this rate');
        fireEvent.click(rates[0]);

        expect(onPickRate).toHaveBeenCalledWith(1250);
    });

    it('renders the rates as plain text when the price is not editable', async () => {
        render(<RateHistory productId="prod-1" type="purchase" />);

        await waitFor(() => expect(screen.getByText(/Previous purchase rates/i)).toBeInTheDocument());
        expect(screen.queryAllByTitle('Use this rate')).toHaveLength(0);
    });

    it('says so plainly when the item has never traded', async () => {
        (api.getProductRateHistory as jest.Mock).mockResolvedValue({
            type: 'sale', forParty: [], recent: [], summary: null,
        });

        render(<RateHistory productId="prod-9" type="sale" />);

        expect(await screen.findByText('No previous sales of this item.')).toBeInTheDocument();
    });

    it('degrades to the empty state rather than breaking entry when the lookup fails', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        (api.getProductRateHistory as jest.Mock).mockRejectedValue(new Error('offline'));

        render(<RateHistory productId="prod-1" type="sale" />);

        expect(await screen.findByText('No previous sales of this item.')).toBeInTheDocument();
    });

    it('serves a repeat lookup from cache — re-picking a product cannot change the answer', async () => {
        const { unmount } = render(<RateHistory productId="prod-1" type="purchase" />);
        await waitFor(() => expect(screen.getByText(/Previous purchase rates/i)).toBeInTheDocument());
        unmount();

        render(<RateHistory productId="prod-1" type="purchase" />);
        await waitFor(() => expect(screen.getByText(/Previous purchase rates/i)).toBeInTheDocument());

        expect(api.getProductRateHistory).toHaveBeenCalledTimes(1);
    });

    it('refetches when the selected party changes, so their own rates lead', async () => {
        const { rerender } = render(<RateHistory productId="prod-1" type="purchase" />);
        await waitFor(() => expect(api.getProductRateHistory).toHaveBeenCalledTimes(1));

        rerender(<RateHistory productId="prod-1" type="purchase" partyId="sup-1" />);
        await waitFor(() => expect(api.getProductRateHistory).toHaveBeenCalledTimes(2));

        expect((api.getProductRateHistory as jest.Mock).mock.calls[1][1]).toMatchObject({
            type: 'purchase',
            partyId: 'sup-1',
        });
    });
});
