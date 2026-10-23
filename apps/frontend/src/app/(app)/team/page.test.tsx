import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '@/lib/api';
import { fetchMe } from '@/hooks/use-me';
import TeamPage from './page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/team',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

jest.mock('@/hooks/use-me', () => ({ fetchMe: jest.fn() }));

jest.mock('@/lib/api', () => ({
    api: {
        getTeamMembers: jest.fn(),
        getTeamInvitations: jest.fn(),
        getTeamRoles: jest.fn(),
        createTeamRole: jest.fn(),
        updateTeamRole: jest.fn(),
        getPreferenceProfiles: jest.fn(),
        getPreferenceProfile: jest.fn(),
        createPreferenceProfile: jest.fn(),
        getAlertPreferences: jest.fn(),
    },
}));

const mockApi = api as jest.Mocked<typeof api>;
const mockFetchMe = fetchMe as jest.Mock;

function signIn(role: string, permissions: string[] = []) {
    mockFetchMe.mockResolvedValue({ tenants: [{ id: 't1', role, permissions }] });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getTeamMembers.mockResolvedValue([]);
    mockApi.getTeamInvitations.mockResolvedValue([]);
    mockApi.getTeamRoles.mockResolvedValue([]);
    mockApi.getPreferenceProfiles.mockResolvedValue([
        {
            id: 'p1',
            name: 'Cashier setup',
            is_default: true,
            roles: [{ id: 'r1', name: 'Cashier' }],
            updated_at: '2026-10-22T00:00:00.000Z',
        },
    ]);
});

describe('TeamPage — Default profiles tab', () => {
    it('tab shown to owner and MANAGE_USERS holders, hidden otherwise', async () => {
        signIn('OWNER');
        const { unmount } = render(<TeamPage />);
        expect(await screen.findByRole('button', { name: 'Default profiles' })).toBeInTheDocument();
        unmount();

        signIn('STAFF', ['MANAGE_USERS']);
        const second = render(<TeamPage />);
        expect(await screen.findByRole('button', { name: 'Default profiles' })).toBeInTheDocument();
        // Role editing stays owner-only.
        expect(screen.queryByRole('button', { name: 'Roles' })).not.toBeInTheDocument();
        second.unmount();

        signIn('STAFF', ['VIEW_SALES']);
        render(<TeamPage />);
        await screen.findByRole('button', { name: 'Members' });
        // Let the membership answer land before checking what it hid.
        await act(async () => {});
        expect(mockFetchMe).toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Default profiles' })).not.toBeInTheDocument();
    });

    it('lists the profiles and puts New profile in the page header', async () => {
        signIn('OWNER');
        render(<TeamPage />);

        expect(screen.queryByRole('button', { name: 'New profile' })).not.toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: 'Default profiles' }));

        expect(await screen.findByText('Cashier setup')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'New profile' }));

        expect(await screen.findByLabelText('Profile name')).toBeInTheDocument();
    });
});

const permissions = ['VIEW_SALES'];
const cashierRole = {
    id: 'r1',
    name: 'Cashier',
    is_system: false,
    permissions,
    member_count: 0,
    preference_profile: { id: 'p1', name: 'Cashier setup' },
};
const clerkRole = {
    id: 'r2',
    name: 'Clerk',
    is_system: false,
    permissions,
    member_count: 0,
    preference_profile: null,
};

describe('TeamPage — role default profile', () => {
    beforeEach(() => {
        mockApi.updateTeamRole.mockResolvedValue({} as never);
        mockApi.createTeamRole.mockResolvedValue({} as never);
    });

    async function openRoleEditor(name: string) {
        signIn('OWNER');
        mockApi.getTeamRoles.mockResolvedValue([cashierRole, clerkRole] as never);
        render(<TeamPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Roles' }));
        const row = (await screen.findByText(name, { selector: 'p' })).closest('div.rounded-lg') as HTMLElement;
        fireEvent.click(within(row).getByRole('button', { name: 'Edit role' }));
        return screen.findByLabelText('Default profile');
    }

    it('role editor shows a Default profile select with None meaning the workspace default', async () => {
        const select = (await openRoleEditor('Clerk')) as HTMLSelectElement;

        const options = Array.from(select.options).map((o) => o.textContent);
        expect(options).toEqual(['None (use the workspace default)', 'Cashier setup']);
        expect(select.value).toBe('');
    });

    it('starts on the role\'s own profile', async () => {
        const select = (await openRoleEditor('Cashier')) as HTMLSelectElement;
        expect(select.value).toBe('p1');
    });

    it('saving sends preference_profile_id (null for None)', async () => {
        const select = await openRoleEditor('Cashier');
        fireEvent.change(select, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save role' }));
        await waitFor(() => expect(mockApi.updateTeamRole).toHaveBeenCalledTimes(1));
        expect(mockApi.updateTeamRole).toHaveBeenCalledWith(
            'r1',
            expect.objectContaining({ preference_profile_id: null }),
        );

    });

    it('saving a chosen profile sends its id', async () => {
        const select = await openRoleEditor('Clerk');
        fireEvent.change(select, { target: { value: 'p1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save role' }));
        await waitFor(() => expect(mockApi.updateTeamRole).toHaveBeenCalledTimes(1));
        expect(mockApi.updateTeamRole).toHaveBeenCalledWith(
            'r2',
            expect.objectContaining({ preference_profile_id: 'p1' }),
        );
    });

    it('shows the profile on the role row', async () => {
        signIn('OWNER');
        mockApi.getTeamRoles.mockResolvedValue([cashierRole, clerkRole] as never);
        render(<TeamPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Roles' }));
        expect(await screen.findByText(/Profile: Cashier setup/)).toBeInTheDocument();
        expect(screen.getAllByText(/Profile:/)).toHaveLength(1);
    });
});

describe('TeamPage — invite starts-with line', () => {
    async function openInvite(roles: unknown[], profiles: unknown[]) {
        signIn('STAFF', ['MANAGE_USERS']);
        mockApi.getTeamRoles.mockResolvedValue(roles as never);
        mockApi.getPreferenceProfiles.mockResolvedValue(profiles as never);
        render(<TeamPage />);
        await screen.findByLabelText('Cashier');
    }

    const shop = { id: 'p2', name: 'Shop default', is_default: true, roles: [], updated_at: '' };
    const cashier = { id: 'p1', name: 'Cashier setup', is_default: false, roles: [], updated_at: '' };

    it('names the primary role\'s profile', async () => {
        await openInvite([cashierRole, clerkRole], [cashier, shop]);
        fireEvent.click(screen.getByLabelText('Cashier'));
        expect(await screen.findByText('Starts with: Cashier setup')).toBeInTheDocument();

        // The first pick stays the primary, so a second role does not change the line.
        fireEvent.click(screen.getByLabelText('Clerk'));
        expect(screen.getByText('Starts with: Cashier setup')).toBeInTheDocument();
    });

    it('falls back to the workspace default when the primary role has no profile', async () => {
        await openInvite([cashierRole, clerkRole], [cashier, shop]);
        fireEvent.click(screen.getByLabelText('Clerk'));
        expect(await screen.findByText('Starts with: Shop default (workspace default)')).toBeInTheDocument();
    });

    it('shows nothing when neither exists', async () => {
        await openInvite([cashierRole, clerkRole], [{ ...cashier, is_default: false }]);
        await act(async () => {});
        fireEvent.click(screen.getByLabelText('Clerk'));
        expect(screen.queryByText(/Starts with/)).not.toBeInTheDocument();
    });

    it('shows nothing before a role is chosen', async () => {
        await openInvite([cashierRole, clerkRole], [cashier, shop]);
        await act(async () => {});
        expect(screen.queryByText(/Starts with/)).not.toBeInTheDocument();
    });
});
