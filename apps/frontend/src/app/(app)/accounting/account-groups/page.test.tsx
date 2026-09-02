'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlatformFeaturesProvider } from '@/contexts/PlatformFeaturesContext';
import AccountGroupsPage from './page';

function renderPage() {
    return render(
        <PlatformFeaturesProvider features={{ feedback: false, support: false, help: true, voice: false, manufacturing: true, aiChat: false, externalImport: false, projects: false, platformProjects: false }}>
            <AccountGroupsPage />
        </PlatformFeaturesProvider>,
    );
}

jest.mock('@/lib/api', () => ({
    api: {
        getAccountGroups: jest.fn(),
        getAccountSubgroups: jest.fn(),
        createAccountGroup: jest.fn(),
        getNextAccountGroupCode: jest.fn(),
        getNextAccountSubgroupCode: jest.fn(),
        updateAccountGroup: jest.fn(),
        deleteAccountGroup: jest.fn(),
        createAccountSubgroup: jest.fn(),
        updateAccountSubgroup: jest.fn(),
        deleteAccountSubgroup: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

describe('AccountGroupsPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        jest.clearAllMocks();
        api.getAccountGroups.mockResolvedValue([
            { id: 'group-1', name: 'Current Assets', code: '11', type: 'asset', _count: { subgroups: 1, accounts: 2 } },
            { id: 'group-2', name: 'Operating Revenue', code: '41', type: 'revenue', _count: { subgroups: 1, accounts: 1 } },
        ]);
        api.getAccountSubgroups.mockResolvedValue([
            { id: 'subgroup-1', name: 'Cash and Bank', code: '1101', group: { id: 'group-1', name: 'Current Assets' }, _count: { accounts: 2 } },
            { id: 'subgroup-2', name: 'Sales', code: '4101', group: { id: 'group-2', name: 'Operating Revenue' }, _count: { accounts: 1 } },
        ]);
        api.createAccountGroup.mockResolvedValue({ id: 'group-3' });
        // Both modals ask the server to suggest the next free code.
        api.getNextAccountGroupCode.mockResolvedValue({ code: '12' });
        api.getNextAccountSubgroupCode.mockResolvedValue({ code: '1102' });
        api.updateAccountGroup.mockResolvedValue({ id: 'group-1' });
        api.deleteAccountGroup.mockResolvedValue({ id: 'group-1' });
        api.createAccountSubgroup.mockResolvedValue({ id: 'subgroup-3' });
        api.updateAccountSubgroup.mockResolvedValue({ id: 'subgroup-1' });
        api.deleteAccountSubgroup.mockResolvedValue({ id: 'subgroup-1' });
    });

    it('groups the rail by account type and opens on the first group', async () => {
        renderPage();

        await waitFor(() => expect(screen.getByText('Current Assets')).toBeInTheDocument());

        expect(screen.getByText('Assets')).toBeInTheDocument();
        expect(screen.getByText('Revenue')).toBeInTheDocument();
        // First group is auto-selected, so its subgroups are the ones listed.
        expect(screen.getByText('Subgroups in Current Assets')).toBeInTheDocument();
        expect(screen.getByText('Cash and Bank')).toBeInTheDocument();
        expect(screen.queryByText('Sales')).not.toBeInTheDocument();
    });

    it('swaps the subgroup pane when another group is selected', async () => {
        renderPage();

        await waitFor(() => expect(screen.getByText('Cash and Bank')).toBeInTheDocument());

        // The rail button reads "41 Operating Revenue …" — the code leads the name.
        fireEvent.click(screen.getByRole('button', { name: /^41 Operating Revenue/ }));

        await waitFor(() => {
            expect(screen.getByText('Subgroups in Operating Revenue')).toBeInTheDocument();
        });
        expect(screen.getByText('Sales')).toBeInTheDocument();
        expect(screen.queryByText('Cash and Bank')).not.toBeInTheDocument();
    });

    it('creates a group from the modal', async () => {
        const { api } = require('@/lib/api');
        renderPage();

        await waitFor(() => screen.getByText('Current Assets'));

        fireEvent.click(screen.getByRole('button', { name: /new group/i }));
        fireEvent.change(screen.getByLabelText('Account group name'), { target: { value: 'Fixed Assets' } });
        fireEvent.change(screen.getByLabelText('Group type'), { target: { value: 'asset' } });

        await waitFor(() => expect(screen.getByLabelText('Group code')).toHaveValue('12'));

        fireEvent.click(screen.getByRole('button', { name: /create group/i }));

        await waitFor(() => {
            expect(api.createAccountGroup).toHaveBeenCalledWith({
                name: 'Fixed Assets',
                type: 'asset',
                code: '12',
            });
        });
    });

    it('creates a subgroup under the selected group', async () => {
        const { api } = require('@/lib/api');
        renderPage();

        await waitFor(() => screen.getByText('Cash and Bank'));

        fireEvent.click(screen.getByRole('button', { name: /add subgroup/i }));
        fireEvent.change(screen.getByLabelText('Subgroup name'), { target: { value: 'Receivables' } });

        await waitFor(() =>
            expect(api.getNextAccountSubgroupCode).toHaveBeenCalledWith('group-1'),
        );
        await waitFor(() => expect(screen.getByLabelText('Subgroup code')).toHaveValue('1102'));

        fireEvent.click(screen.getByRole('button', { name: /create subgroup/i }));

        await waitFor(() => {
            expect(api.createAccountSubgroup).toHaveBeenCalledWith({
                groupId: 'group-1',
                name: 'Receivables',
                code: '1102',
            });
        });
    });

    it('renames a group without touching its type', async () => {
        const { api } = require('@/lib/api');
        renderPage();

        await waitFor(() => screen.getByText('Current Assets'));

        fireEvent.click(screen.getByRole('button', { name: 'Edit — Current Assets' }));
        fireEvent.change(screen.getByLabelText('Account group name'), { target: { value: 'Short-term Assets' } });
        fireEvent.click(screen.getByRole('button', { name: /update group/i }));

        await waitFor(() => {
            expect(api.updateAccountGroup).toHaveBeenCalledWith('group-1', { name: 'Short-term Assets' });
        });
        // The type select is locked while editing — a group's type is immutable.
        expect(api.updateAccountGroup.mock.calls[0][1]).not.toHaveProperty('type');
    });

    it('deletes a group after confirmation', async () => {
        const { api } = require('@/lib/api');
        renderPage();

        await waitFor(() => screen.getByText('Current Assets'));

        fireEvent.click(screen.getByRole('button', { name: 'Delete — Current Assets' }));

        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }),
        );

        await waitFor(() => {
            expect(api.deleteAccountGroup).toHaveBeenCalledWith('group-1');
        });
    });
});
