import { renderHook, waitFor } from '@testing-library/react';
import { clearPrintTemplateCache, usePrintHeader } from './use-print-header';
import { fetchWithAuth } from '../api';

jest.mock('../api', () => ({
    fetchWithAuth: jest.fn(),
}));

jest.mock('../branding', () => ({
    useBranding: () => ({
        logoUrl: 'https://cdn.example.com/brand.png',
        faviconUrl: null,
        businessName: 'Rahim Traders',
        primaryColor: '#0f766e',
    }),
}));

const mockFetch = fetchWithAuth as jest.Mock;

describe('usePrintHeader', () => {
    beforeEach(() => {
        clearPrintTemplateCache();
        jest.clearAllMocks();
    });

    it('falls back to branding until the template resolves', () => {
        mockFetch.mockReturnValue(new Promise(() => { /* never settles */ }));

        const { result } = renderHook(() => usePrintHeader('SALES_INVOICE'));

        expect(result.current.companyName).toBe('Rahim Traders');
        expect(result.current.headerConfig.logo?.url).toBe('https://cdn.example.com/brand.png');
        expect(result.current.headerConfig.company?.color).toBe('#0f766e');
    });

    it('uses the stored template once it resolves', async () => {
        mockFetch.mockResolvedValue({
            template_id: 'tpl1',
            name: 'Letterhead',
            config: { layout: 'logo-center', company: { color: '#111111' } },
        });

        const { result } = renderHook(() => usePrintHeader('SALES_INVOICE'));

        await waitFor(() => expect(result.current.headerConfig.layout).toBe('logo-center'));
        expect(result.current.headerConfig.company?.color).toBe('#111111');
        expect(mockFetch).toHaveBeenCalledWith('/print-templates/resolve?docType=SALES_INVOICE');
    });

    it('keeps printing with branding when the request fails', async () => {
        mockFetch.mockRejectedValue(new Error('offline'));

        const { result } = renderHook(() => usePrintHeader('VOUCHER'));

        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        expect(result.current.headerConfig.logo?.url).toBe('https://cdn.example.com/brand.png');
    });

    it('requests each document type once across components', async () => {
        mockFetch.mockResolvedValue({ template_id: 't', name: 'n', config: {} });

        const first = renderHook(() => usePrintHeader('POS_RECEIPT'));
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
        first.unmount();

        renderHook(() => usePrintHeader('POS_RECEIPT'));
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });
});
