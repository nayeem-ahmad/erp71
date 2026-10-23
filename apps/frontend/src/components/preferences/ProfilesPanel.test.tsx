import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PreferenceProfileDetail, PreferenceProfileSummary } from '@erp71/shared-types';
import Toaster from '@/components/Toaster';
import { api } from '@/lib/api';
import { useToastStore } from '@/lib/toast';
import ProfilesPanel from './ProfilesPanel';

jest.mock('@/lib/api', () => ({
    api: {
        getPreferenceProfiles: jest.fn(),
        getPreferenceProfile: jest.fn(),
        createPreferenceProfile: jest.fn(),
        updatePreferenceProfile: jest.fn(),
        deletePreferenceProfile: jest.fn(),
        getAlertPreferences: jest.fn(),
        getTeamMembers: jest.fn(),
        applyPreferenceProfile: jest.fn(),
        getMyPreferences: jest.fn(),
    },
}));

const mockApi = api as jest.Mocked<typeof api>;

const profiles: PreferenceProfileSummary[] = [
    {
        id: 'p1',
        name: 'Cashier setup',
        is_default: true,
        roles: [
            { id: 'r1', name: 'Cashier' },
            { id: 'r2', name: 'Sales associate' },
        ],
        updated_at: '2026-10-22T00:00:00.000Z',
    },
    { id: 'p2', name: 'Back office', is_default: false, roles: [], updated_at: '2026-10-22T00:00:00.000Z' },
];

function detail(summary: PreferenceProfileSummary): PreferenceProfileDetail {
    return { ...summary, sections: {} };
}

function renderPanel(props: Partial<React.ComponentProps<typeof ProfilesPanel>> = {}) {
    const onCreateClose = jest.fn();
    render(
        <>
            <ProfilesPanel createOpen={false} onCreateClose={onCreateClose} {...props} />
            <Toaster />
        </>,
    );
    return { onCreateClose };
}

beforeEach(() => {
    jest.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    mockApi.getPreferenceProfiles.mockResolvedValue(profiles);
    mockApi.getPreferenceProfile.mockImplementation(async (id: string) =>
        detail(profiles.find((p) => p.id === id) ?? { ...profiles[1], id, name: 'Cashier' }),
    );
    mockApi.getAlertPreferences.mockResolvedValue({ types: [] } as never);
});

describe('ProfilesPanel', () => {
    it('lists profiles with the default badge and role names', async () => {
        renderPanel();

        const cashierRow = (await screen.findByText('Cashier setup')).closest('li') as HTMLElement;
        expect(within(cashierRow).getByText('Workspace default')).toBeInTheDocument();
        expect(within(cashierRow).getByText('Roles: Cashier, Sales associate')).toBeInTheDocument();

        const officeRow = screen.getByText('Back office').closest('li') as HTMLElement;
        expect(within(officeRow).queryByText('Workspace default')).not.toBeInTheDocument();
        expect(within(officeRow).getByText('No role uses this profile yet.')).toBeInTheDocument();
    });

    it('explains what a profile is for when there are none', async () => {
        mockApi.getPreferenceProfiles.mockResolvedValue([]);
        renderPanel();

        expect(await screen.findByText(/No profiles yet/)).toBeInTheDocument();
    });

    it('opens the editor from a row', async () => {
        renderPanel();

        fireEvent.click(await screen.findByRole('button', { name: /Back office/ }));

        expect(await screen.findByRole('heading', { name: 'Edit profile' })).toBeInTheDocument();
        expect(mockApi.getPreferenceProfile).toHaveBeenCalledWith('p2');
    });

    it('New profile → create, then the editor opens', async () => {
        mockApi.createPreferenceProfile.mockResolvedValue({
            id: 'p3',
            name: 'Cashier',
            is_default: false,
            roles: [],
            updated_at: '2026-10-22T00:00:00.000Z',
            sections: {},
        });
        const { onCreateClose } = renderPanel({ createOpen: true });

        fireEvent.change(await screen.findByLabelText('Profile name'), { target: { value: '  Cashier ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        await waitFor(() => expect(mockApi.createPreferenceProfile).toHaveBeenCalledWith({ name: 'Cashier' }));
        expect(onCreateClose).toHaveBeenCalled();
        expect(await screen.findByRole('heading', { name: 'Edit profile' })).toBeInTheDocument();
        expect(mockApi.getPreferenceProfile).toHaveBeenCalledWith('p3');
        // The list picks up the new profile.
        expect(mockApi.getPreferenceProfiles).toHaveBeenCalledTimes(2);
    });

    it('asks for a name before creating', async () => {
        renderPanel({ createOpen: true });

        fireEvent.click(await screen.findByRole('button', { name: 'Create' }));

        expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
        expect(mockApi.createPreferenceProfile).not.toHaveBeenCalled();
    });

    it('a duplicate name shows an inline error, not a toast', async () => {
        mockApi.createPreferenceProfile.mockRejectedValue(
            Object.assign(new Error('A profile with this name already exists.'), { status: 409 }),
        );
        const { onCreateClose } = renderPanel({ createOpen: true });

        fireEvent.change(await screen.findByLabelText('Profile name'), { target: { value: 'Back office' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        const field = await screen.findByRole('alert');
        expect(field).toHaveTextContent('A profile with this name already exists.');
        expect(useToastStore.getState().toasts).toEqual([]);
        expect(onCreateClose).not.toHaveBeenCalled();
    });
});
