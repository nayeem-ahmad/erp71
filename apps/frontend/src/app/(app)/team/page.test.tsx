import { act, fireEvent, render, screen } from '@testing-library/react';
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
