import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
    DEFAULT_INVOICE_PRINT_PREFS,
    DEFAULT_TABLE_VIEW,
    resolvePreferences,
    type PreferenceProfileDetail,
    type SectionPartials,
} from '@erp71/shared-types';
import Toaster from '@/components/Toaster';
import { api } from '@/lib/api';
import { usePreferencesStore } from '@/lib/preferences/store';
import { useToastStore } from '@/lib/toast';
import ProfileEditorModal from './ProfileEditorModal';

jest.mock('@/lib/api', () => ({
    api: {
        getPreferenceProfile: jest.fn(),
        updatePreferenceProfile: jest.fn(),
        deletePreferenceProfile: jest.fn(),
        getAlertPreferences: jest.fn(),
        getTeamMembers: jest.fn(),
        applyPreferenceProfile: jest.fn(),
        getMyPreferences: jest.fn(),
    },
}));

const mockApi = api as jest.Mocked<typeof api>;

function profile(sections: SectionPartials = {}, over: Partial<PreferenceProfileDetail> = {}): PreferenceProfileDetail {
    return {
        id: 'p1',
        name: 'Cashier setup',
        is_default: false,
        roles: [{ id: 'r1', name: 'Cashier' }],
        updated_at: '2026-10-22T00:00:00.000Z',
        sections,
        ...over,
    };
}

function renderEditor(current: PreferenceProfileDetail = profile()) {
    mockApi.getPreferenceProfile.mockResolvedValue(current);
    const onChanged = jest.fn();
    const onClose = jest.fn();
    render(
        <>
            <ProfileEditorModal profileId={current.id} profiles={[current]} onChanged={onChanged} onClose={onClose} />
            <Toaster />
        </>,
    );
    return { onChanged, onClose };
}

const card = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    useToastStore.setState({ toasts: [] });
    usePreferencesStore.setState({ ready: false, scopeKey: null, data: null });
    mockApi.getAlertPreferences.mockResolvedValue({
        types: [
            { type: 'LARGE_SALE', label: 'Large sales', description: 'A sale at or above the line.' },
            { type: 'LOW_STOCK', label: 'Low stock', description: 'Products at or below their reorder level.' },
        ],
    } as never);
    mockApi.updatePreferenceProfile.mockImplementation(async (_id, body) => profile(body.sections as SectionPartials));
});

describe('ProfileEditorModal', () => {
    it('editor saves invoice print, device, list view and alerts sections through updatePreferenceProfile', async () => {
        renderEditor();
        await screen.findByLabelText('Profile name');
        await screen.findByLabelText('Low stock');

        fireEvent.change(within(card('Invoice print')).getByLabelText('Item table style'), {
            target: { value: 'striped' },
        });

        const device = card('New-browser print setup');
        fireEvent.change(within(device).getByLabelText('Paper size'), { target: { value: 'Thermal80' } });
        fireEvent.click(within(device).getByLabelText(/Compact layout/));

        fireEvent.click(within(card('Lists')).getByRole('button', { name: 'Compact' }));

        const alerts = card('Alerts');
        fireEvent.click(within(alerts).getByLabelText('Low stock'));
        fireEvent.change(within(alerts).getByLabelText('From'), { target: { value: '21:00' } });

        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(mockApi.updatePreferenceProfile).toHaveBeenCalledTimes(1));
        expect(mockApi.updatePreferenceProfile).toHaveBeenCalledWith('p1', {
            sections: {
                invoicePrint: { ...DEFAULT_INVOICE_PRINT_PREFS, table_style: 'striped' },
                device: { paperSize: 'Thermal80', printDensity: 'compact' },
                tableView: { global: { ...DEFAULT_TABLE_VIEW, density: 'compact' } },
                alerts: { mutedTypes: ['LOW_STOCK'], quiet: { enabled: true, from: 1260, to: 480 } },
            },
        });
        expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    });

    it('sends only the sections that changed, plus the name and default flag', async () => {
        const { onChanged } = renderEditor(profile({ tableView: { tables: { orders: { density: 'cozy' } } } }));
        const name = await screen.findByLabelText('Profile name');

        fireEvent.change(name, { target: { value: 'Till staff' } });
        fireEvent.click(screen.getByLabelText('Use for members whose role has no profile'));
        fireEvent.click(within(card('Lists')).getByLabelText('Striped rows'));
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() =>
            expect(mockApi.updatePreferenceProfile).toHaveBeenCalledWith('p1', {
                name: 'Till staff',
                is_default: true,
                // A list's own look, set by copying, survives an edit of the global one.
                sections: {
                    tableView: {
                        global: { ...DEFAULT_TABLE_VIEW, striped: false },
                        tables: { orders: { density: 'cozy' } },
                    },
                },
            }),
        );
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
    });

    it('opens on what the profile sets, over the built-in values', async () => {
        renderEditor(
            profile({
                invoicePrint: { serial_column: true },
                device: { paperSize: 'A5', skipPreview: true },
                alerts: { mutedTypes: ['LARGE_SALE'], quiet: { enabled: false } },
            }),
        );
        await screen.findByLabelText('Large sales');

        expect(within(card('Invoice print')).getByLabelText(/Serial number \(SL\) column/)).toBeChecked();
        expect(within(card('New-browser print setup')).getByLabelText('Paper size')).toHaveValue('A5');
        expect(within(card('New-browser print setup')).getByLabelText(/Skip print preview/)).toBeChecked();
        expect(within(card('Alerts')).getByLabelText('Large sales')).toBeChecked();
        expect(within(card('Alerts')).getByLabelText('Quiet hours')).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    });

    it('columns and sidebar cards show "Set for N lists" and Clear sends { tableColumns: null }', async () => {
        renderEditor(
            profile({
                tableColumns: { orders: { hidden: ['total'] }, customers: { pageSize: 50 } },
                sidebar: { appShellOpenGroups: ['sales', 'stock', 'hr'] },
            }),
        );
        await screen.findByLabelText('Profile name');

        expect(within(card('Columns')).getByText('Set for 2 lists')).toBeInTheDocument();
        expect(within(card('Sidebar groups')).getByText('Set for 3 groups')).toBeInTheDocument();

        mockApi.updatePreferenceProfile.mockResolvedValueOnce(
            profile({ sidebar: { appShellOpenGroups: ['sales', 'stock', 'hr'] } }),
        );
        fireEvent.click(within(card('Columns')).getByRole('button', { name: 'Clear' }));

        await waitFor(() =>
            expect(mockApi.updatePreferenceProfile).toHaveBeenCalledWith('p1', { sections: { tableColumns: null } }),
        );
        expect(await within(card('Columns')).findByText('Set with Copy from my settings.')).toBeInTheDocument();
        expect(within(card('Columns')).queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
        expect(within(card('Sidebar groups')).getByText('Set for 3 groups')).toBeInTheDocument();
    });

    it('Copy from my settings sends collectMySettings for the chosen sections, legacy values included', async () => {
        // The admin's lists still come from this browser's old answers.
        window.localStorage.setItem('erp71:table-view:anon', JSON.stringify({ global: { fontSize: 'lg' } }));
        // Read fresh from the server: the store's copy can be behind a save made elsewhere.
        mockApi.getMyPreferences.mockResolvedValue({
            profile: null,
            legacy_browser_sections: ['tableView'],
            sections: resolvePreferences({ member: { alerts: { mutedTypes: ['LOW_STOCK'] } } }),
        });
        window.localStorage.setItem('erp71:sales-print:paper-size', 'Thermal58');
        renderEditor();
        await screen.findByLabelText('Profile name');

        fireEvent.click(screen.getByRole('button', { name: 'Copy from my settings…' }));
        const heading = await screen.findByRole('heading', { name: 'Copy from my settings' });
        const dialog = heading.closest('[role="dialog"]') as HTMLElement;
        const copy = within(dialog).getByRole('button', { name: 'Copy' });
        expect(copy).toBeDisabled();

        fireEvent.click(within(dialog).getByLabelText('Lists'));
        fireEvent.click(within(dialog).getByLabelText('New-browser print setup'));
        fireEvent.click(copy);

        await waitFor(() =>
            expect(mockApi.updatePreferenceProfile).toHaveBeenCalledWith('p1', {
                sections: {
                    tableView: { global: { ...DEFAULT_TABLE_VIEW, fontSize: 'lg' }, tables: {} },
                    device: { paperSize: 'Thermal58' },
                },
            }),
        );
        expect(await screen.findByText('Copied your settings into the profile.')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Copy from my settings' })).not.toBeInTheDocument();
    });

    it('a duplicate name shows an inline error, not a toast', async () => {
        mockApi.updatePreferenceProfile.mockRejectedValue(
            Object.assign(new Error('A profile with this name already exists.'), { status: 409 }),
        );
        renderEditor();

        fireEvent.change(await screen.findByLabelText('Profile name'), { target: { value: 'Back office' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(await screen.findByText('A profile with this name already exists.')).toBeInTheDocument();
        expect(screen.getByLabelText('Profile name')).toHaveAttribute('aria-invalid', 'true');
        expect(useToastStore.getState().toasts).toEqual([]);
    });

    it('holds Apply back until the changes are saved', async () => {
        renderEditor(profile({ invoicePrint: { serial_column: true } }));
        const name = await screen.findByLabelText('Profile name');

        expect(screen.getByRole('button', { name: 'Apply to members…' })).toBeEnabled();
        fireEvent.change(name, { target: { value: 'Till staff' } });

        expect(screen.getByRole('button', { name: 'Apply to members…' })).toBeDisabled();
        expect(screen.getByText('Save your changes before applying.')).toBeInTheDocument();
    });

    it('opens the apply confirmation for the saved profile', async () => {
        mockApi.getTeamMembers.mockResolvedValue([{ userId: 'u1', tenantRoleId: 'r1', isSelf: false }] as never);
        renderEditor(profile({ invoicePrint: { serial_column: true } }));
        await screen.findByLabelText('Profile name');

        fireEvent.click(screen.getByRole('button', { name: 'Apply to members…' }));

        expect(await screen.findByText('1 member follows this profile.')).toBeInTheDocument();
    });

    it('deletes the profile after a confirmation', async () => {
        mockApi.deletePreferenceProfile.mockResolvedValue(undefined);
        const { onChanged, onClose } = renderEditor();
        await screen.findByLabelText('Profile name');

        fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(mockApi.deletePreferenceProfile).toHaveBeenCalledWith('p1'));
        expect(onChanged).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });
});
