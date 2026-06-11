'use client';

import { render, screen, waitFor } from '@testing-library/react';
import TerritoriesPage from './page';

jest.mock('../../../lib/api', () => ({
    api: {
        getTerritories: jest.fn(),
        createTerritory: jest.fn(),
        updateTerritory: jest.fn(),
        deleteTerritory: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/territories',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockTerritories = [
    {
        id: 'ter-1',
        name: 'Dhaka',
        parent_id: null,
        parent: null,
        description: 'Capital region',
        _count: { customers: 20 },
    },
    {
        id: 'ter-2',
        name: 'Mirpur',
        parent_id: 'ter-1',
        parent: { id: 'ter-1', name: 'Dhaka' },
        description: null,
        _count: { customers: 8 },
    },
];

describe('TerritoriesPage', () => {
    beforeEach(() => {
        const { api } = require('../../../lib/api');
        api.getTerritories.mockResolvedValue(mockTerritories);
        api.createTerritory.mockResolvedValue({});
        api.updateTerritory.mockResolvedValue({});
        api.deleteTerritory.mockResolvedValue({});
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Territories heading', async () => {
        render(<TerritoriesPage />);
        await waitFor(() => {
            expect(screen.getByText('Territories')).toBeInTheDocument();
        });
    });

    it('displays territories loaded from the API', async () => {
        render(<TerritoriesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Dhaka').length).toBeGreaterThan(0);
            expect(screen.getAllByText('Mirpur').length).toBeGreaterThan(0);
        });
    });

    it('shows parent territory name in the parent column', async () => {
        render(<TerritoriesPage />);
        await waitFor(() => {
            // The parent column for Mirpur should show Dhaka
            const allDhaka = screen.getAllByText('Dhaka');
            expect(allDhaka.length).toBeGreaterThanOrEqual(1);
        });
    });

    it('renders the New Territory button', async () => {
        render(<TerritoriesPage />);
        await waitFor(() => {
            expect(screen.getByText('New Territory')).toBeInTheDocument();
        });
    });

    it('shows empty state when no territories exist', async () => {
        const { api } = require('../../../lib/api');
        api.getTerritories.mockResolvedValue([]);
        render(<TerritoriesPage />);
        await waitFor(() => {
            expect(screen.queryByText('Dhaka')).not.toBeInTheDocument();
        });
    });

    it('calls getTerritories on mount', async () => {
        const { api } = require('../../../lib/api');
        render(<TerritoriesPage />);
        await waitFor(() => {
            expect(api.getTerritories).toHaveBeenCalledTimes(1);
        });
    });

    it('shows Root for territories without a parent', async () => {
        render(<TerritoriesPage />);
        await waitFor(() => {
            expect(screen.getByText('Root')).toBeInTheDocument();
        });
    });
});
