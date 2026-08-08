import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import BoardsPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: { getBoards: jest.fn(), createBoard: jest.fn(), deleteBoard: jest.fn() },
}));

describe('BoardsPage', () => {
    beforeEach(() => {
        // The mocked `api` module is shared across every test in this file, so its
        // call counts must be reset here — otherwise `toHaveBeenCalledTimes`
        // assertions accumulate calls from earlier tests in the suite.
        (api.getBoards as jest.Mock).mockReset().mockResolvedValue([
            { id: 'b1', name: 'Release 4', description: 'Cross-team', card_count: 7 },
        ]);
        (api.createBoard as jest.Mock).mockReset().mockResolvedValue({ id: 'b2' });
        (api.deleteBoard as jest.Mock).mockReset().mockResolvedValue({});
    });

    it('lists boards with their card counts', async () => {
        render(<BoardsPage />);
        expect(await screen.findByText('Release 4')).toBeInTheDocument();
        expect(screen.getByText(/7/)).toBeInTheDocument();
    });

    it('shows an empty state when there are no boards', async () => {
        (api.getBoards as jest.Mock).mockResolvedValue([]);
        render(<BoardsPage />);
        expect(await screen.findByText(/no boards yet/i)).toBeInTheDocument();
    });

    it('creates a board from the modal and reloads the list', async () => {
        render(<BoardsPage />);
        await screen.findByText('Release 4');

        fireEvent.click(screen.getByRole('button', { name: /new board/i }));
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Support queue' } });
        fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

        await waitFor(() =>
            expect(api.createBoard).toHaveBeenCalledWith({ name: 'Support queue', description: '' }),
        );
        expect(api.getBoards).toHaveBeenCalledTimes(2);
    });
});
