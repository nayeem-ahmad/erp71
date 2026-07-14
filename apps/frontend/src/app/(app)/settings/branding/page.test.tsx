import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BrandingSettingsPage from './page';
import Toaster from '@/components/Toaster';
import { useToastStore } from '@/lib/toast';

function renderPage() {
    return render(
        <>
            <BrandingSettingsPage />
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
    fetchWithAuth: jest.fn(),
}));

import { fetchWithAuth } from '@/lib/api';
const mockFetchWithAuth = fetchWithAuth as jest.MockedFunction<typeof fetchWithAuth>;

const brandingData = {
    brand_business_name: 'My Shop',
    brand_primary_color: '#ff0000',
    brand_logo_url: 'https://example.com/logo.png',
    brand_favicon_url: 'https://example.com/fav.ico',
};

beforeEach(() => {
    jest.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    // Default: GET returns branding data, PATCH resolves
    mockFetchWithAuth.mockImplementation((url: string, options?: any) => {
        if (!options || options.method !== 'PATCH') {
            return Promise.resolve(brandingData);
        }
        return Promise.resolve({});
    });
});

describe('BrandingSettingsPage', () => {
    it('shows loading spinner initially', () => {
        mockFetchWithAuth.mockReturnValue(new Promise(() => {}));
        renderPage();
        expect(screen.getByText('Loading branding settings…')).toBeInTheDocument();
    });

    it('renders the Branding heading after load', async () => {
        renderPage();
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Branding' })).toBeInTheDocument();
        });
    });

    it('renders page description', async () => {
        renderPage();
        await waitFor(() => {
            expect(screen.getByText(/Customize your dashboard with your logo/)).toBeInTheDocument();
        });
    });

    it('populates form fields with fetched branding data', async () => {
        renderPage();
        await waitFor(() => {
            expect((screen.getByPlaceholderText('Your Business Name') as HTMLInputElement).value).toBe('My Shop');
        });
        expect((screen.getByPlaceholderText('https://example.com/logo.png') as HTMLInputElement).value).toBe('https://example.com/logo.png');
        expect((screen.getByPlaceholderText('https://example.com/favicon.ico') as HTMLInputElement).value).toBe('https://example.com/fav.ico');
    });

    it('renders Save Branding button', async () => {
        renderPage();
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Save Branding' })).toBeInTheDocument();
        });
    });

    it('uses defaults when API returns nothing', async () => {
        mockFetchWithAuth.mockResolvedValue(null);
        renderPage();
        await waitFor(() => {
            const businessNameInput = screen.getByPlaceholderText('Your Business Name') as HTMLInputElement;
            expect(businessNameInput.value).toBe('');
        });
    });

    it('uses defaults when API rejects', async () => {
        mockFetchWithAuth.mockRejectedValue(new Error('fetch failed'));
        renderPage();
        await waitFor(() => {
            expect(screen.getByPlaceholderText('Your Business Name')).toBeInTheDocument();
        });
    });

    it('updates business name input', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByPlaceholderText('Your Business Name')).toBeInTheDocument());
        const input = screen.getByPlaceholderText('Your Business Name') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'New Name' } });
        expect(input.value).toBe('New Name');
    });

    it('updates hex color input', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByPlaceholderText('#2563eb')).toBeInTheDocument());
        const hexInput = screen.getByPlaceholderText('#2563eb') as HTMLInputElement;
        fireEvent.change(hexInput, { target: { value: '#abc123' } });
        expect(hexInput.value).toBe('#abc123');
    });

    it('prepends # when typing hex without it', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByPlaceholderText('#2563eb')).toBeInTheDocument());
        const hexInput = screen.getByPlaceholderText('#2563eb') as HTMLInputElement;
        fireEvent.change(hexInput, { target: { value: 'abc123' } });
        expect(hexInput.value).toBe('#abc123');
    });

    it('updates color via color picker input', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByTitle('Pick a color')).toBeInTheDocument());
        const colorPicker = screen.getByTitle('Pick a color') as HTMLInputElement;
        fireEvent.change(colorPicker, { target: { value: '#123456' } });
        expect((screen.getByPlaceholderText('#2563eb') as HTMLInputElement).value).toBe('#123456');
    });

    it('updates logo URL input', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByPlaceholderText('https://example.com/logo.png')).toBeInTheDocument());
        const logoInput = screen.getByPlaceholderText('https://example.com/logo.png') as HTMLInputElement;
        fireEvent.change(logoInput, { target: { value: 'https://cdn.example.com/new-logo.png' } });
        expect(logoInput.value).toBe('https://cdn.example.com/new-logo.png');
    });

    it('shows logo preview when logo URL is set', async () => {
        renderPage();
        await waitFor(() => {
            expect(screen.getByAltText('Logo preview')).toBeInTheDocument();
        });
    });

    it('shows favicon preview when favicon URL is set', async () => {
        renderPage();
        await waitFor(() => {
            expect(screen.getByAltText('Favicon preview')).toBeInTheDocument();
            expect(screen.getByText('Favicon preview')).toBeInTheDocument();
        });
    });

    it('shows success toast after saving', async () => {
        mockFetchWithAuth.mockImplementation((url: string, options?: any) => {
            if (!options || options.method !== 'PATCH') return Promise.resolve(brandingData);
            return Promise.resolve({});
        });
        renderPage();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save Branding' })).toBeInTheDocument());
        await act(async () => {
            fireEvent.submit(screen.getByRole('button', { name: 'Save Branding' }).closest('form')!);
        });
        await waitFor(() => {
            expect(screen.getByText('Branding settings saved successfully.')).toBeInTheDocument();
        });
    });

    it('calls PATCH /tenants/branding on submit', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save Branding' })).toBeInTheDocument());
        await act(async () => {
            fireEvent.submit(screen.getByRole('button', { name: 'Save Branding' }).closest('form')!);
        });
        await waitFor(() => {
            const calls = mockFetchWithAuth.mock.calls;
            const patchCall = calls.find((c) => c[1]?.method === 'PATCH');
            expect(patchCall).toBeDefined();
            expect(patchCall![0]).toBe('/tenants/branding');
        });
    });

    it('shows error toast when save fails', async () => {
        mockFetchWithAuth.mockImplementation((url: string, options?: any) => {
            if (!options || options.method !== 'PATCH') return Promise.resolve(brandingData);
            return Promise.reject(new Error('Server error'));
        });
        renderPage();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save Branding' })).toBeInTheDocument());
        await act(async () => {
            fireEvent.submit(screen.getByRole('button', { name: 'Save Branding' }).closest('form')!);
        });
        await waitFor(() => {
            expect(screen.getByText('Server error')).toBeInTheDocument();
        });
    });

    it('shows Saving… text while save is in progress', async () => {
        let resolvePromise: (v: any) => void;
        const pending = new Promise((resolve) => { resolvePromise = resolve; });
        mockFetchWithAuth.mockImplementation((url: string, options?: any) => {
            if (!options || options.method !== 'PATCH') return Promise.resolve(brandingData);
            return pending;
        });
        renderPage();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save Branding' })).toBeInTheDocument());
        fireEvent.submit(screen.getByRole('button', { name: 'Save Branding' }).closest('form')!);
        await waitFor(() => {
            expect(screen.getByText('Saving…')).toBeInTheDocument();
        });
        act(() => resolvePromise!({}));
    });

    it('disables Save button while saving', async () => {
        mockFetchWithAuth.mockImplementation((url: string, options?: any) => {
            if (!options || options.method !== 'PATCH') return Promise.resolve(brandingData);
            return new Promise(() => {});
        });
        renderPage();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save Branding' })).toBeInTheDocument());
        fireEvent.submit(screen.getByRole('button', { name: 'Save Branding' }).closest('form')!);
        await waitFor(() => {
            const btn = screen.getByText('Saving…').closest('button')!;
            expect(btn).toBeDisabled();
        });
    });

    it('applies color CSS variable when saved with valid color', async () => {
        const setPropertySpy = jest.spyOn(document.documentElement.style, 'setProperty');
        mockFetchWithAuth.mockImplementation((url: string, options?: any) => {
            if (!options || options.method !== 'PATCH') return Promise.resolve({ ...brandingData, brand_primary_color: '#abcdef' });
            return Promise.resolve({});
        });
        renderPage();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save Branding' })).toBeInTheDocument());
        // Set a valid hex color
        const hexInput = screen.getByPlaceholderText('#2563eb');
        fireEvent.change(hexInput, { target: { value: '#abcdef' } });
        await act(async () => {
            fireEvent.submit(screen.getByRole('button', { name: 'Save Branding' }).closest('form')!);
        });
        await waitFor(() => {
            expect(setPropertySpy).toHaveBeenCalledWith('--color-primary', '#abcdef');
        });
        setPropertySpy.mockRestore();
    });
});
