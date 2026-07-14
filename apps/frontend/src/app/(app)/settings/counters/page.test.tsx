import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CountersPage from './page';
import Toaster from '@/components/Toaster';
import { useToastStore } from '@/lib/toast';

function renderPage() {
    return render(
        <>
            <CountersPage />
            <Toaster />
        </>,
    );
}

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/test',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCounters: jest.fn(),
        createCounter: jest.fn(),
        updateCounter: jest.fn(),
        deleteCounter: jest.fn(),
    },
}));

import { api } from '@/lib/api';

const mockApi = api as jest.Mocked<typeof api>;

const sampleCounters = [
    { id: 'c1', name: 'Counter 1', counter_number: 1, status: 'ACTIVE', store_id: 'store-1' },
    { id: 'c2', name: 'Express Lane', counter_number: 2, status: 'INACTIVE', store_id: 'store-1' },
];

function setupLocalStorage(storeId = 'store-1') {
    Object.defineProperty(window, 'localStorage', {
        value: {
            getItem: jest.fn((key) => {
                if (key === 'store_id') return storeId;
                return null;
            }),
            setItem: jest.fn(),
            removeItem: jest.fn(),
            clear: jest.fn(),
        },
        writable: true,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    setupLocalStorage('store-1');
});

describe('CountersPage — no store selected', () => {
    it('shows a message when no store_id in localStorage', async () => {
        setupLocalStorage('');
        renderPage();
        expect(screen.getByText(/No store selected/)).toBeInTheDocument();
    });
});

describe('CountersPage — with store selected', () => {
    it('shows loading state initially', () => {
        mockApi.getCounters.mockReturnValue(new Promise(() => {}));
        renderPage();
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the page heading after load', async () => {
        mockApi.getCounters.mockResolvedValue([]);
        renderPage();
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'POS Counters' })).toBeInTheDocument();
        });
    });

    it('shows empty state when no counters', async () => {
        mockApi.getCounters.mockResolvedValue([]);
        renderPage();
        await waitFor(() => {
            expect(screen.getByText('No counters yet')).toBeInTheDocument();
        });
    });

    it('renders counter list', async () => {
        mockApi.getCounters.mockResolvedValue(sampleCounters);
        renderPage();
        await waitFor(() => {
            expect(screen.getByText('Counter 1')).toBeInTheDocument();
            expect(screen.getByText('Express Lane')).toBeInTheDocument();
        });
    });

    it('shows Active badge for ACTIVE counter', async () => {
        mockApi.getCounters.mockResolvedValue(sampleCounters);
        renderPage();
        await waitFor(() => {
            expect(screen.getByText('Active')).toBeInTheDocument();
        });
    });

    it('shows Inactive badge for INACTIVE counter', async () => {
        mockApi.getCounters.mockResolvedValue(sampleCounters);
        renderPage();
        await waitFor(() => {
            expect(screen.getByText('Inactive')).toBeInTheDocument();
        });
    });

    it('handles API returning data wrapped in .data property', async () => {
        mockApi.getCounters.mockResolvedValue({ data: sampleCounters } as any);
        renderPage();
        await waitFor(() => {
            expect(screen.getByText('Counter 1')).toBeInTheDocument();
        });
    });

    it('shows error toast when load fails', async () => {
        mockApi.getCounters.mockRejectedValue(new Error('Network error'));
        renderPage();
        await waitFor(() => {
            expect(screen.getByText('Failed to load counters')).toBeInTheDocument();
        });
    });

    it('opens Add Counter dialog when button is clicked', async () => {
        mockApi.getCounters.mockResolvedValue([]);
        renderPage();
        await waitFor(() => expect(screen.getByText('No counters yet')).toBeInTheDocument());
        fireEvent.click(screen.getAllByText('Add Counter')[0]);
        expect(screen.getByText('Add Counter', { selector: 'h2' })).toBeInTheDocument();
    });

    it('shows Counter Number field only in Add mode (not Edit mode)', async () => {
        mockApi.getCounters.mockResolvedValue([]);
        renderPage();
        await waitFor(() => expect(screen.getByText('No counters yet')).toBeInTheDocument());
        fireEvent.click(screen.getAllByText('Add Counter')[0]);
        expect(screen.getByPlaceholderText('1')).toBeInTheDocument();
    });

    it('closes Add dialog when X button clicked', async () => {
        mockApi.getCounters.mockResolvedValue([]);
        renderPage();
        await waitFor(() => expect(screen.getByText('No counters yet')).toBeInTheDocument());
        fireEvent.click(screen.getAllByText('Add Counter')[0]);
        expect(screen.getByText('Add Counter', { selector: 'h2' })).toBeInTheDocument();
        const closeBtn = screen.getByRole('button', { name: 'Close' });
        fireEvent.click(closeBtn);
        expect(screen.queryByText('Add Counter', { selector: 'h2' })).not.toBeInTheDocument();
    });

    it('shows validation error when saving empty form', async () => {
        mockApi.getCounters.mockResolvedValue([]);
        renderPage();
        await waitFor(() => expect(screen.getByText('No counters yet')).toBeInTheDocument());
        fireEvent.click(screen.getAllByText('Add Counter')[0]);
        fireEvent.click(screen.getByText('Create Counter'));
        await waitFor(() => {
            expect(screen.getByText('Name and counter number are required')).toBeInTheDocument();
        });
    });

    it('creates a counter successfully', async () => {
        mockApi.getCounters
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([sampleCounters[0]]);
        mockApi.createCounter.mockResolvedValue({ id: 'c1' });
        renderPage();
        await waitFor(() => expect(screen.getByText('No counters yet')).toBeInTheDocument());
        fireEvent.click(screen.getAllByText('Add Counter')[0]);
        fireEvent.change(screen.getByPlaceholderText('e.g. Counter 1, Express Lane'), {
            target: { value: 'Counter 1' },
        });
        fireEvent.change(screen.getByPlaceholderText('1'), {
            target: { value: '1' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Create Counter'));
        });
        await waitFor(() => {
            expect(mockApi.createCounter).toHaveBeenCalledWith({
                storeId: 'store-1',
                name: 'Counter 1',
                counterNumber: 1,
            });
            expect(screen.getByText('Counter created')).toBeInTheDocument();
        });
    });

    it('shows error toast when create fails', async () => {
        mockApi.getCounters.mockResolvedValue([]);
        mockApi.createCounter.mockRejectedValue(new Error('Create failed'));
        renderPage();
        await waitFor(() => expect(screen.getByText('No counters yet')).toBeInTheDocument());
        fireEvent.click(screen.getAllByText('Add Counter')[0]);
        fireEvent.change(screen.getByPlaceholderText('e.g. Counter 1, Express Lane'), {
            target: { value: 'Counter 1' },
        });
        fireEvent.change(screen.getByPlaceholderText('1'), {
            target: { value: '2' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Create Counter'));
        });
        await waitFor(() => {
            expect(screen.getByText('Create failed')).toBeInTheDocument();
        });
    });

    it('opens Edit dialog with pre-filled values', async () => {
        mockApi.getCounters.mockResolvedValue(sampleCounters);
        renderPage();
        await waitFor(() => expect(screen.getByText('Counter 1')).toBeInTheDocument());
        // Click edit (pencil icon button) for first counter
        const editButtons = document.querySelectorAll('button[class*="hover:text-blue-600"]');
        fireEvent.click(editButtons[0]);
        expect(screen.getByText('Edit Counter')).toBeInTheDocument();
        expect((screen.getByPlaceholderText('e.g. Counter 1, Express Lane') as HTMLInputElement).value).toBe('Counter 1');
    });

    it('shows Status dropdown in edit mode', async () => {
        mockApi.getCounters.mockResolvedValue(sampleCounters);
        renderPage();
        await waitFor(() => expect(screen.getByText('Counter 1')).toBeInTheDocument());
        const editButtons = document.querySelectorAll('button[class*="hover:text-blue-600"]');
        fireEvent.click(editButtons[0]);
        expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('saves edit successfully', async () => {
        mockApi.getCounters
            .mockResolvedValueOnce(sampleCounters)
            .mockResolvedValueOnce(sampleCounters);
        mockApi.updateCounter.mockResolvedValue({});
        renderPage();
        await waitFor(() => expect(screen.getByText('Counter 1')).toBeInTheDocument());
        const editButtons = document.querySelectorAll('button[class*="hover:text-blue-600"]');
        fireEvent.click(editButtons[0]);
        fireEvent.change(screen.getByPlaceholderText('e.g. Counter 1, Express Lane'), {
            target: { value: 'Updated Counter' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Save Changes'));
        });
        await waitFor(() => {
            expect(mockApi.updateCounter).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'Updated Counter' }));
            expect(screen.getByText('Counter updated')).toBeInTheDocument();
        });
    });

    it('deletes a counter after confirmation', async () => {
        window.confirm = jest.fn().mockReturnValue(true);
        mockApi.getCounters
            .mockResolvedValueOnce(sampleCounters)
            .mockResolvedValueOnce([sampleCounters[1]]);
        mockApi.deleteCounter.mockResolvedValue({});
        renderPage();
        await waitFor(() => expect(screen.getByText('Counter 1')).toBeInTheDocument());
        const deleteButtons = document.querySelectorAll('button[class*="hover:text-red-600"]');
        await act(async () => {
            fireEvent.click(deleteButtons[0]);
        });
        await waitFor(() => {
            expect(mockApi.deleteCounter).toHaveBeenCalledWith('c1');
            expect(screen.getByText('Counter deleted')).toBeInTheDocument();
        });
    });

    it('does not delete when confirmation is cancelled', async () => {
        window.confirm = jest.fn().mockReturnValue(false);
        mockApi.getCounters.mockResolvedValue(sampleCounters);
        renderPage();
        await waitFor(() => expect(screen.getByText('Counter 1')).toBeInTheDocument());
        const deleteButtons = document.querySelectorAll('button[class*="hover:text-red-600"]');
        fireEvent.click(deleteButtons[0]);
        expect(mockApi.deleteCounter).not.toHaveBeenCalled();
    });

    it('toggles counter status from ACTIVE to INACTIVE', async () => {
        mockApi.getCounters
            .mockResolvedValueOnce(sampleCounters)
            .mockResolvedValueOnce(sampleCounters);
        mockApi.updateCounter.mockResolvedValue({});
        renderPage();
        await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());
        await act(async () => {
            fireEvent.click(screen.getByText('Active'));
        });
        await waitFor(() => {
            expect(mockApi.updateCounter).toHaveBeenCalledWith('c1', { status: 'INACTIVE' });
            expect(screen.getByText('Counter deactivated')).toBeInTheDocument();
        });
    });

    it('toggles counter status from INACTIVE to ACTIVE', async () => {
        mockApi.getCounters
            .mockResolvedValueOnce(sampleCounters)
            .mockResolvedValueOnce(sampleCounters);
        mockApi.updateCounter.mockResolvedValue({});
        renderPage();
        await waitFor(() => expect(screen.getByText('Inactive')).toBeInTheDocument());
        await act(async () => {
            fireEvent.click(screen.getByText('Inactive'));
        });
        await waitFor(() => {
            expect(mockApi.updateCounter).toHaveBeenCalledWith('c2', { status: 'ACTIVE' });
            expect(screen.getByText('Counter activated')).toBeInTheDocument();
        });
    });

    it('shows error toast when delete fails', async () => {
        window.confirm = jest.fn().mockReturnValue(true);
        mockApi.getCounters.mockResolvedValue(sampleCounters);
        mockApi.deleteCounter.mockRejectedValue(new Error('Delete failed'));
        renderPage();
        await waitFor(() => expect(screen.getByText('Counter 1')).toBeInTheDocument());
        const deleteButtons = document.querySelectorAll('button[class*="hover:text-red-600"]');
        await act(async () => {
            fireEvent.click(deleteButtons[0]);
        });
        await waitFor(() => {
            expect(screen.getByText('Delete failed')).toBeInTheDocument();
        });
    });

    it('opens Add First Counter button from empty state', async () => {
        mockApi.getCounters.mockResolvedValue([]);
        renderPage();
        await waitFor(() => expect(screen.getByText('No counters yet')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Add First Counter'));
        expect(screen.getByText('Add Counter', { selector: 'h2' })).toBeInTheDocument();
    });
});
