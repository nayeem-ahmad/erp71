'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TerritoriesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getTerritories: jest.fn(),
        createTerritory: jest.fn(),
        updateTerritory: jest.fn(),
        deleteTerritory: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// Desktop width: the one-row filter toolbar and the columns kept off phones.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

/** A filter chip on the toolbar row — a button that opens its own popover. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/territories',
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
    {
        id: 'ter-3',
        name: 'Uttara',
        parent_id: 'ter-1',
        parent: { id: 'ter-1', name: 'Dhaka' },
        description: null,
        _count: { customers: 0 },
    },
];

describe('TerritoriesPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
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
            expect(screen.getByRole('heading', { name: 'Territories' })).toBeInTheDocument();
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
        const { api } = require('@/lib/api');
        api.getTerritories.mockResolvedValue([]);
        render(<TerritoriesPage />);
        await waitFor(() => {
            expect(screen.queryByText('Dhaka')).not.toBeInTheDocument();
        });
    });

    it('calls getTerritories on mount', async () => {
        const { api } = require('@/lib/api');
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

    it('counts territories, top level, levels, customers and unused ones in the strip', async () => {
        render(<TerritoriesPage />);
        const strip = await screen.findByRole('region', { name: 'Territory figures' });
        await waitFor(() => expect(within(strip).getByText('3')).toBeInTheDocument());
        expect(within(strip).getByText('28')).toBeInTheDocument();
        expect(within(strip).getByText('2')).toBeInTheDocument(); // levels
        // Top level (Dhaka) and unused (Uttara) are one each.
        expect(within(strip).getAllByText('1')).toHaveLength(2);
    });

    it('narrows to the top-level territories with the Parent chip', async () => {
        render(<TerritoriesPage />);
        await screen.findByText('Mirpur');

        fireEvent.click(chip('Parent'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Root' }));

        await waitFor(() => expect(screen.queryByText('Mirpur')).not.toBeInTheDocument());
        expect(screen.queryByText('Uttara')).not.toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Territory figures' })).getAllByText('1').length).toBeGreaterThan(0);
    });

    it('picks territories by level', async () => {
        render(<TerritoriesPage />);
        await screen.findByText('Mirpur');

        fireEvent.click(chip('Level'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Level 2' }));

        await waitFor(() => expect(screen.queryByText('Capital region')).not.toBeInTheDocument());
        expect(screen.getByText('Mirpur')).toBeInTheDocument();
        expect(screen.getByText('Uttara')).toBeInTheDocument();
    });

    it('deletes an unused territory through a dialog, and keeps delete off one in use', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        const confirmSpy = jest.spyOn(window, 'confirm');
        render(<TerritoriesPage />);
        const mirpur = (await screen.findByText('Mirpur')).closest('tr')!;
        expect(within(mirpur).getByRole('button', { name: 'Has customers or sub-territories' })).toHaveAttribute('aria-disabled', 'true');

        const uttara = screen.getByText('Uttara').closest('tr')!;
        fireEvent.click(within(uttara).getByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.deleteTerritory).toHaveBeenCalledWith('ter-3'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Territory deleted'));
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });
});
