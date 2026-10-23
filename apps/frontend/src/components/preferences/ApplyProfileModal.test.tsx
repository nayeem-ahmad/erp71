import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PreferenceProfileDetail, PreferenceProfileSummary } from '@erp71/shared-types';
import Toaster from '@/components/Toaster';
import { api } from '@/lib/api';
import { useToastStore } from '@/lib/toast';
import ApplyProfileModal, { membersFollowing } from './ApplyProfileModal';

jest.mock('@/lib/api', () => ({
    api: {
        getTeamMembers: jest.fn(),
        applyPreferenceProfile: jest.fn(),
    },
}));

const mockApi = api as jest.Mocked<typeof api>;

const cashier: PreferenceProfileDetail = {
    id: 'p1',
    name: 'Cashier setup',
    is_default: false,
    roles: [{ id: 'r-cashier', name: 'Cashier' }],
    updated_at: '2026-10-22T00:00:00.000Z',
    sections: {
        invoicePrint: { serial_column: true },
        tableView: { global: { density: 'compact' } },
        // A till setting: never something a member answers, so never applied.
        device: { paperSize: 'Thermal80' },
    },
};

const office: PreferenceProfileSummary = {
    id: 'p2',
    name: 'Back office',
    is_default: true,
    roles: [{ id: 'r-accounts', name: 'Accounts' }],
    updated_at: '2026-10-22T00:00:00.000Z',
};

const members = [
    { userId: 'u1', tenantRoleId: 'r-cashier', isSelf: false },
    // The admin applying it is never changed by it.
    { userId: 'u2', tenantRoleId: 'r-cashier', isSelf: true },
    { userId: 'u3', tenantRoleId: 'r-accounts', isSelf: false },
    { userId: 'u4', tenantRoleId: 'r-cashier', isSelf: false },
    { userId: 'u5', tenantRoleId: 'r-sales', isSelf: false },
    { userId: 'u6', tenantRoleId: null, isSelf: false },
];

beforeEach(() => {
    jest.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    mockApi.getTeamMembers.mockResolvedValue(members as never);
    mockApi.applyPreferenceProfile.mockResolvedValue({ updated: 2 });
});

describe('membersFollowing', () => {
    it('counts the members whose primary role uses the profile, never the caller', () => {
        expect(membersFollowing(members, cashier, [cashier, office])).toBe(2);
    });

    it('adds members whose role has no profile, or who have no role, to the default profile', () => {
        // u3 (Accounts → this profile), u5 (Sales has none), u6 (no role).
        expect(membersFollowing(members, office, [cashier, office])).toBe(3);
    });
});

describe('ApplyProfileModal', () => {
    it('Apply modal names the sections and count, then calls applyPreferenceProfile', async () => {
        const onClose = jest.fn();
        render(
            <>
                <ApplyProfileModal profile={cashier} profiles={[cashier, office]} onClose={onClose} />
                <Toaster />
            </>,
        );

        expect(await screen.findByText('2 members follow this profile.')).toBeInTheDocument();
        // The person sections the profile sets start chosen and are named in the summary.
        expect(screen.getByLabelText('Invoice print')).toBeChecked();
        expect(screen.getByLabelText('Lists')).toBeChecked();
        expect(screen.getByLabelText('Alerts')).not.toBeChecked();
        expect(screen.queryByLabelText('New-browser print setup')).not.toBeInTheDocument();
        expect(screen.getByText('Invoice print, Lists')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        await waitFor(() =>
            expect(mockApi.applyPreferenceProfile).toHaveBeenCalledWith('p1', { sections: ['invoicePrint', 'tableView'] }),
        );
        expect(await screen.findByText('Applied to 2 members')).toBeInTheDocument();
        expect(onClose).toHaveBeenCalled();
    });

    it('names a section the admin adds', async () => {
        render(<ApplyProfileModal profile={cashier} profiles={[cashier, office]} onClose={jest.fn()} />);
        await screen.findByText('2 members follow this profile.');

        fireEvent.click(screen.getByLabelText('Invoice print'));
        fireEvent.click(screen.getByLabelText('Alerts'));

        expect(screen.getByText('Lists, Alerts')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        await waitFor(() =>
            expect(mockApi.applyPreferenceProfile).toHaveBeenCalledWith('p1', { sections: ['tableView', 'alerts'] }),
        );
    });

    it('cannot apply with no section chosen', async () => {
        render(
            <ApplyProfileModal
                profile={{ ...cashier, sections: { device: { paperSize: 'A4' } } }}
                profiles={[cashier, office]}
                onClose={jest.fn()}
            />,
        );
        await screen.findByText('2 members follow this profile.');

        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    });

    it('still offers to apply when the member list cannot be read, without a number', async () => {
        mockApi.getTeamMembers.mockRejectedValue(new Error('nope'));
        render(<ApplyProfileModal profile={cashier} profiles={[cashier, office]} onClose={jest.fn()} />);

        expect(await screen.findByText('Members whose role uses this profile follow it again.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    });

    it('reports a failure through the toaster and stays open', async () => {
        mockApi.applyPreferenceProfile.mockRejectedValue(new Error('Server down'));
        const onClose = jest.fn();
        render(
            <>
                <ApplyProfileModal profile={cashier} profiles={[cashier, office]} onClose={onClose} />
                <Toaster />
            </>,
        );
        await screen.findByText('2 members follow this profile.');

        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        expect(await screen.findByText('Server down')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });
});
