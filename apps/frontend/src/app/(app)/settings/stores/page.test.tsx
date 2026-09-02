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

    it('surfaces the server message when the name is already taken', async () => {
        mockApi.createStore.mockRejectedValue(new Error('A store with that name already exists.'));
        await openModal();
        fireEvent.change(screen.getByLabelText(/Store name/, { selector: '#new-store-name' }), {
            target: { value: 'Main Store' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        expect(await screen.findByText('A store with that name already exists.')).toBeInTheDocument();
        expect(mockApi.getStores).toHaveBeenCalledTimes(1);
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
});
