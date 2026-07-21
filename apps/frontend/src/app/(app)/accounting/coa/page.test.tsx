'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlatformFeaturesProvider } from '@/contexts/PlatformFeaturesContext';
import ChartOfAccountsPage from './page';

function renderPage() {
    return render(
        <PlatformFeaturesProvider features={{ feedback: false, support: false, help: true, voice: false, manufacturing: true, aiChat: false }}>
            <ChartOfAccountsPage />
        </PlatformFeaturesProvider>,
    );
}

jest.mock('@/lib/api', () => ({
    api: {
        getAccountGroups: jest.fn(),
        getAccountSubgroups: jest.fn(),
        getAccounts: jest.fn(),
        createAccountGroup: jest.fn(),
        createAccountSubgroup: jest.fn(),
        createAccount: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

describe('ChartOfAccountsPage — Story 30.2', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getAccountGroups.mockResolvedValue([
            { id: 'group-1', name: 'Current Assets', type: 'asset', _count: { subgroups: 1, accounts: 2 } },
        ]);
        api.getAccountSubgroups.mockResolvedValue([
            { id: 'subgroup-1', name: 'Cash and Bank', group: { id: 'group-1', name: 'Current Assets' }, _count: { accounts: 2 } },
        ]);
        api.getAccounts.mockResolvedValue([
            {
                id: 'account-1',
                name: 'Cash in Hand',
                code: '1010',
                type: 'asset',
                category: 'cash',
                group: { id: 'group-1', name: 'Current Assets', type: 'asset' },
                subgroup: { id: 'subgroup-1', name: 'Cash and Bank' },
            },
        ]);
        api.createAccountGroup.mockResolvedValue({ id: 'group-2' });
        api.createAccountSubgroup.mockResolvedValue({ id: 'subgroup-2' });
        api.createAccount.mockResolvedValue({ id: 'account-2' });
    });

    it('renders loaded account hierarchy and account list', async () => {
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('Account Directory')).toBeInTheDocument();
            expect(screen.getByText('Cash in Hand')).toBeInTheDocument();
            expect(screen.getByText('Chart of Accounts quick guide')).toBeInTheDocument();
        });

        expect(screen.getAllByText('Current Assets').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Cash and Bank').length).toBeGreaterThan(0);
    });

    it('applies account type filters through the API loader', async () => {
        const { api } = require('@/lib/api');
        renderPage();

        await waitFor(() => expect(api.getAccounts).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'asset' } });

        await waitFor(() => {
            expect(api.getAccounts).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'asset' }));
        });
    });

    it('creates an account group from the inline form', async () => {
        const { api } = require('@/lib/api');
        renderPage();

        await waitFor(() => screen.getByText('Cash in Hand'));

        fireEvent.change(screen.getByLabelText('Account group name'), { target: { value: 'Revenue Accounts' } });
        fireEvent.change(screen.getByLabelText('Group type'), { target: { value: 'revenue' } });
        fireEvent.click(screen.getByRole('button', { name: /create group/i }));

        await waitFor(() => {
            expect(api.createAccountGroup).toHaveBeenCalledWith({
                name: 'Revenue Accounts',
                type: 'revenue',
            });
        });
    });
});