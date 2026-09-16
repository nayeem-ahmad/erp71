import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StoreSettingsPage from './page';
import Toaster from '@/components/Toaster';
import { useToastStore } from '@/lib/toast';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/settings/stores',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getStores: jest.fn(),
        createStore: jest.fn(),
        updateStore: jest.fn(),
    },
}));

jest.mock('@/lib/use-tenant-plan-features', () => ({
    useTenantPlanFeatures: jest.fn(),
}));

import { api } from '@/lib/api';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';

const mockApi = api as jest.Mocked<typeof api>;
const mockPlan = useTenantPlanFeatures as jest.Mock;

function setPlan({ multiStore = false, ready = true } = {}) {
    mockPlan.mockReturnValue({
        planCode: 'STANDARD',
        features: { multiStore },
        dashboardPreference: 'AUTO',
        permissions: [],
        role: 'OWNER',
        ready,
    });
}

function renderPage() {
    return render(
        <>
            <StoreSettingsPage />
            <Toaster />
        </>,
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    mockApi.getStores.mockResolvedValue([{ id: 's1', name: 'Main Store' }] as any);
    setPlan({ multiStore: true });
});

describe('StoreSettingsPage — plan gating', () => {
    it('offers the add button when the plan includes multiStore', async () => {
        renderPage();
        expect(await screen.findByRole('button', { name: 'Add store' })).toBeInTheDocument();
        expect(screen.queryByText(/Your plan covers a single store/)).not.toBeInTheDocument();
    });

    it('hides the add button and explains why when the plan does not', async () => {
        setPlan({ multiStore: false });
        renderPage();
        expect(await screen.findByText(/Your plan covers a single store/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add store' })).not.toBeInTheDocument();
    });

    it('shows neither the button nor the notice until the plan has loaded', () => {
        setPlan({ multiStore: false, ready: false });
        renderPage();
        expect(screen.queryByRole('button', { name: 'Add store' })).not.toBeInTheDocument();
        expect(screen.queryByText(/Your plan covers a single store/)).not.toBeInTheDocument();
    });
});

describe('StoreSettingsPage — adding a store', () => {
    async function openModal() {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Add store' }));
        return screen.findByLabelText(/Address \(optional\)/);
    }

    it('creates the store and reloads the list', async () => {
        mockApi.createStore.mockResolvedValue({ id: 's2', name: 'Uttara', address: 'Sector 7' } as any);
        await openModal();

        fireEvent.change(screen.getByLabelText(/Store name/, { selector: '#new-store-name' }), {
            target: { value: '  Uttara  ' },
        });
        fireEvent.change(screen.getByLabelText(/Address \(optional\)/), { target: { value: 'Sector 7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        await waitFor(() =>
            expect(mockApi.createStore).toHaveBeenCalledWith({ name: 'Uttara', address: 'Sector 7' }),
        );
        expect(await screen.findByText('Store added.')).toBeInTheDocument();
        // Once on mount, once after the create — the branch switcher reads the same source.
        await waitFor(() => expect(mockApi.getStores).toHaveBeenCalledTimes(2));
    });

    it('omits an empty address rather than sending a blank string', async () => {
        mockApi.createStore.mockResolvedValue({ id: 's2', name: 'Uttara', address: null } as any);
        await openModal();
        fireEvent.change(screen.getByLabelText(/Store name/, { selector: '#new-store-name' }), {
            target: { value: 'Uttara' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        await waitFor(() =>
            expect(mockApi.createStore).toHaveBeenCalledWith({ name: 'Uttara', address: undefined }),
        );
    });

    it('blocks an empty name inline instead of calling the API', async () => {
        await openModal();
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Store name is required.');
        expect(mockApi.createStore).not.toHaveBeenCalled();
    });

    // The server is still the backstop: `getStores` only returns the branches
    // this user can reach, so a name taken by one they cannot see passes the
    // check below and comes back as a 409.
    it('surfaces the server message when the name is already taken', async () => {
        mockApi.createStore.mockRejectedValue(new Error('A store with that name already exists.'));
        await openModal();
        fireEvent.change(screen.getByLabelText(/Store name/, { selector: '#new-store-name' }), {
            target: { value: 'A Branch This User Cannot See' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        expect(await screen.findByText('A store with that name already exists.')).toBeInTheDocument();
        expect(mockApi.getStores).toHaveBeenCalledTimes(1);
    });

    it('refuses a name already in the list without calling the API', async () => {
        await openModal();
        fireEvent.change(screen.getByLabelText(/Store name/, { selector: '#new-store-name' }), {
            target: { value: 'Main Store' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('A store with this name already exists');
        expect(mockApi.createStore).not.toHaveBeenCalled();
    });

    it('matches an existing branch name regardless of case or padding', async () => {
        await openModal();
        fireEvent.change(screen.getByLabelText(/Store name/, { selector: '#new-store-name' }), {
            target: { value: '  main store  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('A store with this name already exists');
        expect(mockApi.createStore).not.toHaveBeenCalled();
    });
});

describe('StoreSettingsPage — renaming', () => {
    it('saves a trimmed name for an existing store', async () => {
        mockApi.updateStore.mockResolvedValue({ id: 's1', name: 'Gulshan' } as any);
        renderPage();
        const input = await screen.findByLabelText(/Store name/, { selector: '#store-s1' });
        fireEvent.change(input, { target: { value: '  Gulshan  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(mockApi.updateStore).toHaveBeenCalledWith('s1', { name: 'Gulshan' }));
        expect(await screen.findByText('Store name updated.')).toBeInTheDocument();
    });

    // Neither rule was enforced on this path until 2026-09-16 — a branch could
    // be renamed to blank, or onto another branch's name, and the switcher shows
    // the name and nothing else.
    it.each([
        ['an empty name', ''],
        ['a whitespace-only name', '   '],
    ])('refuses %s inline rather than calling the API', async (_label, value) => {
        renderPage();
        const input = await screen.findByLabelText(/Store name/, { selector: '#store-s1' });
        fireEvent.change(input, { target: { value } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Store name is required.');
        expect(mockApi.updateStore).not.toHaveBeenCalled();
    });

    it('refuses a rename onto another branch in the list', async () => {
        mockApi.getStores.mockResolvedValue([
            { id: 's1', name: 'Main Store' },
            { id: 's2', name: 'Gulshan' },
        ] as any);
        renderPage();
        const input = await screen.findByLabelText(/Store name/, { selector: '#store-s1' });
        fireEvent.change(input, { target: { value: 'Gulshan' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

        expect(await screen.findByRole('alert')).toHaveTextContent('A store with this name already exists');
        expect(mockApi.updateStore).not.toHaveBeenCalled();
    });

    it('lets a branch keep its own name', async () => {
        mockApi.updateStore.mockResolvedValue({ id: 's1', name: 'Main Store' } as any);
        renderPage();
        await screen.findByLabelText(/Store name/, { selector: '#store-s1' });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(mockApi.updateStore).toHaveBeenCalledWith('s1', { name: 'Main Store' }));
    });

    it('clears the inline error once the field is edited again', async () => {
        renderPage();
        const input = await screen.findByLabelText(/Store name/, { selector: '#store-s1' });
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByRole('alert');

        fireEvent.change(input, { target: { value: 'G' } });

        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
});
