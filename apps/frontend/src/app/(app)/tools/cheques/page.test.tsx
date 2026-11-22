import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChequesPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: { getCheques: jest.fn(), createCheque: jest.fn(), updateCheque: jest.fn(), deleteCheque: jest.fn() },
}));

const tally = (count: number, amount: number) => ({ count, amount });
const REGISTER = {
    items: [
        {
            id: 'c1', direction: 'ISSUED', status: 'PENDING', bank_name: 'Sonali Bank', branch_name: null, account_number: null,
            cheque_number: '0012345', party_name: 'Rahim Traders', amount: 125000, cheque_date: '2099-01-01', account_payee: true,
            memo: null, status_changed_at: null, created_at: '2026-11-22T00:00:00Z',
        },
    ],
    summary: { issuedOpen: tally(1, 125000), receivedOpen: tally(0, 0), issuedDueSoon: tally(0, 0), receivedDueSoon: tally(0, 0), dueSoonDays: 7 },
};

describe('ChequesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCheques as jest.Mock).mockResolvedValue(REGISTER);
        (api.createCheque as jest.Mock).mockResolvedValue(REGISTER.items[0]);
    });

    it('lists the open cheques by default', async () => {
        render(<ChequesPage />);
        expect(await screen.findByText('Rahim Traders')).toBeInTheDocument();
        expect(api.getCheques).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
    });

    it('checks the form inline and shows the amount in words', async () => {
        render(<ChequesPage />);
        await screen.findByText('Rahim Traders');
        fireEvent.click(screen.getByRole('button', { name: /New cheque/ }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save cheque' }));
        });
        expect(api.createCheque).not.toHaveBeenCalled();
        expect(screen.getAllByText('Required').length).toBeGreaterThan(0);

        fireEvent.change(screen.getByLabelText(/Pay to/), { target: { value: 'Karim' } });
        fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '150000' } });
        fireEvent.change(screen.getByLabelText(/Cheque number/), { target: { value: '77' } });
        fireEvent.change(screen.getByLabelText(/^Bank/), { target: { value: 'DBBL' } });
        expect(screen.getByText('Taka One Lakh Fifty Thousand Only')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save cheque' }));
        });
        await waitFor(() =>
            expect(api.createCheque).toHaveBeenCalledWith(expect.objectContaining({ direction: 'ISSUED', partyName: 'Karim', amount: 150000, chequeNumber: '77', bankName: 'DBBL' })),
        );
    });
});
