'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlatformFeaturesProvider } from '@/contexts/PlatformFeaturesContext';
import ChartOfAccountsPage from './page';

function renderPage() {
    return render(
        <PlatformFeaturesProvider features={{ feedback: false, support: false, help: true, voice: false, manufacturing: true, aiChat: false, externalImport: false, projects: false }}>
            <ChartOfAccountsPage />
        </PlatformFeaturesProvider>,
    );
}

jest.mock('@/lib/api', () => ({
    api: {
        getAccountGroups: jest.fn(),
        getAccountSubgroups: jest.fn(),
        getAccounts: jest.fn(),
        getNextAccountCode: jest.fn(),
        createAccount: jest.fn(),
        updateAccount: jest.fn(),
        deleteAccount: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

describe('ChartOfAccountsPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        jest.clearAllMocks();
        api.getAccountGroups.mockResolvedValue([
            { id: 'group-1', name: 'Current Assets', code: '11', type: 'asset', _count: { subgroups: 1, accounts: 2 } },
        ]);
        api.getAccountSubgroups.mockResolvedValue([
            { id: 'subgroup-1', name: 'Cash and Bank', code: '1101', group: { id: 'group-1', name: 'Current Assets' }, _count: { accounts: 2 } },
        ]);
        api.getAccounts.mockResolvedValue([
            {
                id: 'account-1',
                name: 'Cash in Hand',
                code: '110101',
                type: 'asset',
                category: 'cash',
                group: { id: 'group-1', name: 'Current Assets', code: '11', type: 'asset' },
                subgroup: { id: 'subgroup-1', name: 'Cash and Bank', code: '1101' },
                balance: 3800,
                balance_side: 'debit',
            },
        ]);
        // The modal asks for a suggested code whenever the parent changes.
        api.getNextAccountCode.mockResolvedValue({ code: '110102' });
        api.createAccount.mockResolvedValue({ id: 'account-2' });
        api.updateAccount.mockResolvedValue({ id: 'account-1' });
        api.deleteAccount.mockResolvedValue({ id: 'account-1' });
    });

    it('renders the account list', async () => {
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('Cash in Hand')).toBeInTheDocument();
        });

        // The code leads every row, at every viewport.
        expect(screen.getByText('110101')).toBeInTheDocument();
        expect(screen.getAllByText('Current Assets').length).toBeGreaterThan(0);
    });

    it('shows each account current balance with the side it sits on', async () => {
        renderPage();

        await waitFor(() => screen.getByText('Cash in Hand'));

        expect(screen.getByText(/3,800/)).toBeInTheDocument();
        expect(screen.getByText('Debit')).toBeInTheDocument();
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

    it('creates an account from the modal, deriving the type from the chosen group', async () => {
        const { api } = require('@/lib/api');
        renderPage();

        await waitFor(() => screen.getByText('Cash in Hand'));

        fireEvent.click(screen.getByRole('button', { name: /new account/i }));

        fireEvent.change(screen.getByLabelText('Account group'), { target: { value: 'group-1' } });
        fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Petty Cash' } });

        // Choosing a parent asks the server for the next free code and fills it in.
        await waitFor(() =>
            expect(api.getNextAccountCode).toHaveBeenCalledWith('group-1', undefined),
        );
        await waitFor(() =>
            expect(screen.getByLabelText('Account code')).toHaveValue('110102'),
        );

        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        await waitFor(() => {
            expect(api.createAccount).toHaveBeenCalledWith({
                groupId: 'group-1',
                subgroupId: undefined,
                name: 'Petty Cash',
                code: '110102',
                category: 'general',
                type: 'asset',
            });
        });
    });

    it('keeps an existing code when the account is not moved', async () => {
        const { api } = require('@/lib/api');
        renderPage();

        await waitFor(() => screen.getByText('Cash in Hand'));

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

        // The suggestion must not overwrite a code that already sits under the
        // account's current parent.
        await waitFor(() => expect(api.getNextAccountCode).toHaveBeenCalled());
        expect(screen.getByLabelText('Account code')).toHaveValue('110101');
        expect(screen.queryByText(/changes its code/i)).not.toBeInTheDocument();
    });

    it('edits an existing account without sending a hand-picked type', async () => {
        const { api } = require('@/lib/api');
        renderPage();

        await waitFor(() => screen.getByText('Cash in Hand'));

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Cash on Hand' } });
        fireEvent.click(screen.getByRole('button', { name: /update account/i }));

        await waitFor(() => {
            expect(api.updateAccount).toHaveBeenCalledWith('account-1', {
                groupId: 'group-1',
                subgroupId: 'subgroup-1',
                name: 'Cash on Hand',
                code: '110101',
                category: 'cash',
            });
        });
        expect(api.updateAccount.mock.calls[0][1]).not.toHaveProperty('type');
    });

    it('deletes an account after confirmation', async () => {
        const { api } = require('@/lib/api');
        renderPage();

        await waitFor(() => screen.getByText('Cash in Hand'));

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }),
        );

        await waitFor(() => {
            expect(api.deleteAccount).toHaveBeenCalledWith('account-1');
        });
    });
});
