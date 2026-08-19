import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import BoardsPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: { getBoards: jest.fn(), createBoard: jest.fn(), deleteBoard: jest.fn() },
}));

// The global matchMedia mock always reports non-matching, so without this the
// `hideOnMobile` description column this suite asserts on never renders.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
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

    it('keeps the table, its search box and its filters when there are no boards', async () => {
        // An empty workspace used to get one line of grey text and nothing else —
        // no search, no filters, no sign of what a board list holds.
        (api.getBoards as jest.Mock).mockResolvedValue([]);
        render(<BoardsPage />);

        expect(await screen.findByText(/no boards yet/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/search board name or description/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('All boards')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /new board/i })).toBeInTheDocument();
    });

    it('narrows the list by search text, matching name or description', async () => {
        (api.getBoards as jest.Mock).mockResolvedValue([
            { id: 'b1', name: 'Release 4', description: 'Cross-team', card_count: 7 },
            { id: 'b2', name: 'Support queue', description: 'Triage', card_count: 0 },
        ]);
        render(<BoardsPage />);
        await screen.findByText('Release 4');

        fireEvent.change(screen.getByPlaceholderText(/search board name or description/i), {
            target: { value: 'triage' },
        });

        expect(screen.getByText('Support queue')).toBeInTheDocument();
        expect(screen.queryByText('Release 4')).not.toBeInTheDocument();
        // Filtering is local: the endpoint hands back the whole list in one go.
        expect(api.getBoards).toHaveBeenCalledTimes(1);
    });

    it('splits boards that hold cards from the empty ones', async () => {
        (api.getBoards as jest.Mock).mockResolvedValue([
            { id: 'b1', name: 'Release 4', description: 'Cross-team', card_count: 7 },
            { id: 'b2', name: 'Support queue', description: 'Triage', card_count: 0 },
        ]);
        render(<BoardsPage />);
        await screen.findByText('Release 4');

        fireEvent.change(screen.getByDisplayValue('All boards'), { target: { value: 'empty' } });

        expect(screen.getByText('Support queue')).toBeInTheDocument();
        expect(screen.queryByText('Release 4')).not.toBeInTheDocument();
    });

    it('creates a board from the modal and reloads the list', async () => {
        render(<BoardsPage />);
        await screen.findByText('Release 4');

        fireEvent.click(screen.getByRole('button', { name: /new board/i }));
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Support queue' } });
        fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

        await waitFor(() =>
            expect(api.createBoard).toHaveBeenCalledWith({ name: 'Support queue' }),
        );
        expect(api.getBoards).toHaveBeenCalledTimes(2);
    });

    it('includes a trimmed description when one is given', async () => {
        render(<BoardsPage />);
        await screen.findByText('Release 4');

        fireEvent.click(screen.getByRole('button', { name: /new board/i }));
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Support queue' } });
        fireEvent.change(screen.getByLabelText(/description/i), {
            target: { value: '  Cross-team triage  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

        await waitFor(() =>
            expect(api.createBoard).toHaveBeenCalledWith({
                name: 'Support queue',
                description: 'Cross-team triage',
            }),
        );
    });
});
