import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { api } from '@/lib/api';
import RateHistory, { clearRateHistoryCache, resetRateHistoryPartyOnly } from './RateHistory';

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
        render(<RateHistory productId="prod-1" type="purchase" partyId="sup-1" />);

        await waitFor(() => expect(screen.getByText(/Previous purchase rates/i)).toBeInTheDocument());

        // The selected supplier heads the list; the supplier-less purchase is
        // labelled rather than dropped.
        expect(screen.getAllByText('Rahim Traders').length).toBeGreaterThan(0);
        expect(screen.getByText('No supplier')).toBeInTheDocument();
        expect(screen.getByText('×10')).toBeInTheDocument();
        // Labelled by role — the name is already on every row in the section.
        expect(screen.getByText('This supplier')).toBeInTheDocument();
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

/**
 * Six rows across two parties, so a merged list has to both sort by date and
 * cut at five — a fixture of five could pass either way.
 */
const SALE_HISTORY = {
    type: 'sale' as const,
    forParty: [
        row('sale-a', 'INV-0009', '2026-09-10', 'cus-1', 'Karim Store', 900),
        row('sale-b', 'INV-0004', '2026-08-20', 'cus-1', 'Karim Store', 880),
    ],
    recent: [
        row('sale-c', 'INV-0008', '2026-09-08', 'cus-2', 'Bashundhara Mart', 950),
        row('sale-d', 'INV-0007', '2026-09-05', 'cus-3', 'Agora Retail', 940),
        row('sale-e', 'INV-0006', '2026-09-01', null, null, 930),
        row('sale-f', 'INV-0001', '2026-07-02', 'cus-4', 'Meena Bazar', 800),
    ],
    summary: { lastRate: 900, avgRate: 900, minRate: 800, maxRate: 950 },
};

function row(
    documentId: string,
    documentNumber: string,
    date: string,
    partyId: string | null,
    partyName: string | null,
    rate: number,
) {
    return {
        documentId,
        documentNumber,
        date: `${date}T00:00:00.000Z`,
        partyId,
        partyName,
        quantity: 2,
        rate,
        lineTotal: rate * 2,
    };
}

describe('RateHistory — this-customer-only filter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearRateHistoryCache();
        resetRateHistoryPartyOnly();
        (api.getProductRateHistory as jest.Mock).mockResolvedValue(SALE_HISTORY);
    });

    it('leads with every customer, not just the selected one', async () => {
        render(<RateHistory productId="prod-1" type="sale" partyId="cus-1" />);

        await screen.findByText('Bashundhara Mart');
        // Unfiltered is the default: the question is "what does this item go
        // out at", not "what does this one customer pay".
        expect(screen.getByLabelText('This customer only')).not.toBeChecked();
        expect(screen.getAllByText('Karim Store').length).toBeGreaterThan(0);
    });

    it('narrows to the selected customer when the box is ticked', async () => {
        render(<RateHistory productId="prod-1" type="sale" partyId="cus-1" />);
        await screen.findByText('Bashundhara Mart');

        fireEvent.click(screen.getByLabelText('This customer only'));

        expect(screen.getAllByText('Karim Store').length).toBeGreaterThan(0);
        expect(screen.queryByText('Bashundhara Mart')).not.toBeInTheDocument();
        expect(screen.queryByText('Agora Retail')).not.toBeInTheDocument();
    });

    it('cannot be narrowed to a customer that has not been chosen yet', async () => {
        render(<RateHistory productId="prod-1" type="sale" />);
        await screen.findByText('Bashundhara Mart');

        expect(screen.getByLabelText('This customer only')).toBeDisabled();
    });

    it('carries the choice across every surface showing history', async () => {
        render(
            <>
                <div data-testid="first"><RateHistory productId="prod-1" type="sale" partyId="cus-1" /></div>
                <div data-testid="second"><RateHistory productId="prod-1" type="sale" partyId="cus-1" /></div>
            </>,
        );
        await waitFor(() => expect(screen.getAllByText('Bashundhara Mart')).toHaveLength(2));

        // Tick it on one panel; the per-line modal and the entry bar agree.
        fireEvent.click(screen.getAllByLabelText('This customer only')[0]);

        await waitFor(() => expect(screen.queryByText('Bashundhara Mart')).not.toBeInTheDocument());
        expect(screen.getAllByLabelText('This customer only')[1]).toBeChecked();
    });

    it('says plainly when the customer has never bought the item', async () => {
        (api.getProductRateHistory as jest.Mock).mockResolvedValue({
            ...SALE_HISTORY, forParty: [],
        });
        render(<RateHistory productId="prod-1" type="sale" partyId="cus-9" />);
        await screen.findByText('Bashundhara Mart');

        fireEvent.click(screen.getByLabelText('This customer only'));

        expect(screen.getByText('No previous sales of this item to this customer.')).toBeInTheDocument();
    });
});

describe('RateHistory — inline variant', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearRateHistoryCache();
        resetRateHistoryPartyOnly();
        (api.getProductRateHistory as jest.Mock).mockResolvedValue(SALE_HISTORY);
    });

    it('shows the five most recent lines across all customers, newest first', async () => {
        render(<RateHistory productId="prod-1" type="sale" partyId="cus-1" variant="inline" />);

        await screen.findByText('Bashundhara Mart');
        const names = screen.getAllByTestId('rate-history-party').map((el) => el.textContent);

        // Six rows exist; the oldest (Meena Bazar, July) is the one cut.
        expect(names).toEqual([
            'Karim Store',        // 2026-09-10
            'Bashundhara Mart',   // 2026-09-08
            'Agora Retail',       // 2026-09-05
            'Walk-in',            // 2026-09-01
            'Karim Store',        // 2026-08-20
        ]);
        expect(screen.queryByText('Meena Bazar')).not.toBeInTheDocument();
    });

    it('drops the section headings a flat list does not need', async () => {
        render(<RateHistory productId="prod-1" type="sale" partyId="cus-1" variant="inline" />);
        await screen.findByText('Bashundhara Mart');

        expect(screen.queryByText('This customer')).not.toBeInTheDocument();
        expect(screen.queryByText('Other customers')).not.toBeInTheDocument();
    });
});
