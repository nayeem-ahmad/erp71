import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProductionDeployPage from './page';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/admin/platform-settings/deploy'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

function getFetchWithAuth() {
    return require('@/lib/api').fetchWithAuth;
}

const pending = {
    liveSha: 'abcdef1234567890',
    productionBranch: 'main',
    mainSha: '9876543210fedcba',
    aheadBy: 3,
    lastRun: { id: 5, status: 'completed', conclusion: 'success', url: 'https://gh/run/5', createdAt: '2026-07-11T10:00:00Z', title: 'Deploy main' },
};

describe('ProductionDeployPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getFetchWithAuth().mockResolvedValue(pending);
        window.confirm = jest.fn(() => true);
    });

    it('loads deploy status on mount', async () => {
        render(<ProductionDeployPage />);
        await waitFor(() => {
            expect(getFetchWithAuth()).toHaveBeenCalledWith('/admin/deploy/status');
        });
    });

    it('renders short live and production SHAs', async () => {
        render(<ProductionDeployPage />);
        await waitFor(() => {
            expect(screen.getByText('abcdef1')).toBeInTheDocument();
            expect(screen.getByText('9876543')).toBeInTheDocument();
        });
    });

    it('shows how many commits are pending', async () => {
        render(<ProductionDeployPage />);
        await waitFor(() => {
            expect(screen.getByText(/3 commits/i)).toBeInTheDocument();
        });
    });

    it('shows up-to-date state when aheadBy is 0', async () => {
        getFetchWithAuth().mockResolvedValue({ ...pending, aheadBy: 0 });
        render(<ProductionDeployPage />);
        await waitFor(() => {
            expect(screen.getByText(/up to date/i)).toBeInTheDocument();
        });
    });

    it('triggers a deploy via POST after confirmation', async () => {
        const fetchWithAuth = getFetchWithAuth();
        render(<ProductionDeployPage />);
        await waitFor(() => screen.getByRole('button', { name: /deploy to production/i }));
        fireEvent.click(screen.getByRole('button', { name: /deploy to production/i }));
        await waitFor(() => {
            expect(fetchWithAuth).toHaveBeenCalledWith('/admin/deploy', expect.objectContaining({ method: 'POST' }));
        });
    });

    it('does not deploy when the confirmation is dismissed', async () => {
        (window.confirm as jest.Mock).mockReturnValue(false);
        const fetchWithAuth = getFetchWithAuth();
        render(<ProductionDeployPage />);
        await waitFor(() => screen.getByRole('button', { name: /deploy to production/i }));
        fireEvent.click(screen.getByRole('button', { name: /deploy to production/i }));
        await new Promise((r) => setTimeout(r, 0));
        expect(fetchWithAuth).not.toHaveBeenCalledWith('/admin/deploy', expect.anything());
    });

    it('shows a success toast after triggering a deploy', async () => {
        render(<ProductionDeployPage />);
        await waitFor(() => screen.getByRole('button', { name: /deploy to production/i }));
        fireEvent.click(screen.getByRole('button', { name: /deploy to production/i }));
        await waitFor(() => {
            expect(screen.getByText(/deploy triggered/i)).toBeInTheDocument();
        });
    });
});
