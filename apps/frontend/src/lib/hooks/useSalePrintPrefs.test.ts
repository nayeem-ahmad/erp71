import { act, renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_SECTION_VALUES, type DevicePrefs } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { usePreferencesStore } from '@/lib/preferences/store';
import { resolvePrintPaper, useSalePrintPrefs } from './useSalePrintPrefs';
import { signInForPreferences } from '@/test-utils/preferences-scope';

jest.mock('@/lib/api', () => ({
    api: { getSalesSettings: jest.fn() },
}));

const getSalesSettings = api.getSalesSettings as jest.Mock;

const PAPER_KEY = 'erp71:sales-print:paper-size';
const SKIP_KEY = 'erp71:sales-print:skip-preview';

function hydrateProfile(device: DevicePrefs) {
    usePreferencesStore.getState().hydrate('t1:u1', {
        profile: { id: 'p1', name: 'Cashier' },
        legacy_browser_sections: [],
        sections: {
            invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: 'default' },
            tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
            tableColumns: { value: {}, source: 'default' },
            sidebar: { value: DEFAULT_SECTION_VALUES.sidebar, source: 'default' },
            alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
            device: { value: device, source: 'profile' },
        },
    });
}

beforeEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    signInForPreferences('t1:u1');
    usePreferencesStore.getState().clear();
    getSalesSettings.mockReset();
});

describe('resolvePrintPaper', () => {
    it('takes the paper this browser chose in Print settings', async () => {
        localStorage.setItem('erp71:sales-print:paper-size', 'A5');

        await expect(resolvePrintPaper()).resolves.toBe('A5');
        expect(getSalesSettings).not.toHaveBeenCalled();
    });

    it('falls back to the shop default when this browser chose nothing', async () => {
        getSalesSettings.mockResolvedValue({ default_paper_size: 'Letter' });

        await expect(resolvePrintPaper()).resolves.toBe('Letter');
    });

    it('ignores a stored value that is not a paper size', async () => {
        localStorage.setItem('erp71:sales-print:paper-size', 'Poster');
        getSalesSettings.mockResolvedValue({ default_paper_size: 'Thermal80' });

        await expect(resolvePrintPaper()).resolves.toBe('Thermal80');
    });

    it('prints on A4 when neither is set or the settings cannot be read', async () => {
        getSalesSettings.mockResolvedValueOnce({});
        await expect(resolvePrintPaper()).resolves.toBe('A4');

        getSalesSettings.mockRejectedValueOnce(new Error('offline'));
        await expect(resolvePrintPaper()).resolves.toBe('A4');
    });

    describe('with a profile', () => {
        it('stored beats the profile', async () => {
            localStorage.setItem(PAPER_KEY, 'A5');
            hydrateProfile({ paperSize: 'Thermal80' });

            await expect(resolvePrintPaper()).resolves.toBe('A5');
        });

        it('profile beats the shop default, without asking the shop', async () => {
            getSalesSettings.mockResolvedValue({ default_paper_size: 'Letter' });
            hydrateProfile({ paperSize: 'Thermal80' });

            await expect(resolvePrintPaper()).resolves.toBe('Thermal80');
            expect(getSalesSettings).not.toHaveBeenCalled();
        });

        it('a profile that sets no paper leaves the shop default and A4 as before', async () => {
            hydrateProfile({ skipPreview: true });
            getSalesSettings.mockResolvedValueOnce({ default_paper_size: 'Letter' });
            await expect(resolvePrintPaper()).resolves.toBe('Letter');

            getSalesSettings.mockResolvedValueOnce({});
            await expect(resolvePrintPaper()).resolves.toBe('A4');
        });

        it('nothing is written to localStorage when the profile value is used', async () => {
            const setItem = jest.spyOn(Storage.prototype, 'setItem');
            hydrateProfile({ paperSize: 'Thermal58' });

            await resolvePrintPaper();

            expect(setItem).not.toHaveBeenCalled();
        });
    });
});

describe('useSalePrintPrefs', () => {
    it('paper: stored value wins over the profile', async () => {
        localStorage.setItem(PAPER_KEY, 'A5');
        hydrateProfile({ paperSize: 'Thermal80' });

        const { result } = renderHook(() => useSalePrintPrefs());

        await waitFor(() => expect(result.current.paperSize).toBe('A5'));
        expect(getSalesSettings).not.toHaveBeenCalled();
    });

    it('paper: profile Thermal80 beats the shop default and skips the shop request', async () => {
        getSalesSettings.mockResolvedValue({ default_paper_size: 'Letter' });
        hydrateProfile({ paperSize: 'Thermal80' });

        const { result } = renderHook(() => useSalePrintPrefs());

        await waitFor(() => expect(result.current.paperSize).toBe('Thermal80'));
        expect(getSalesSettings).not.toHaveBeenCalled();
    });

    it('paper: shop default when neither this browser nor the profile has one', async () => {
        getSalesSettings.mockResolvedValue({ default_paper_size: 'Letter' });
        hydrateProfile({});

        const { result } = renderHook(() => useSalePrintPrefs());

        await waitFor(() => expect(result.current.paperSize).toBe('Letter'));
    });

    it('paper: A4 when nothing is set anywhere', async () => {
        getSalesSettings.mockResolvedValue({});

        const { result } = renderHook(() => useSalePrintPrefs());

        await waitFor(() => expect(getSalesSettings).toHaveBeenCalled());
        expect(result.current.paperSize).toBe('A4');
    });

    it('paper: a profile that arrives after mount is shown', async () => {
        getSalesSettings.mockResolvedValue({});
        const { result } = renderHook(() => useSalePrintPrefs());

        act(() => hydrateProfile({ paperSize: 'A5' }));

        await waitFor(() => expect(result.current.paperSize).toBe('A5'));
    });

    it('paper: a shop answer that lands after the profile does not override it', async () => {
        let resolveShop!: (value: unknown) => void;
        getSalesSettings.mockReturnValue(new Promise((resolve) => { resolveShop = resolve; }));
        const { result } = renderHook(() => useSalePrintPrefs());

        act(() => hydrateProfile({ paperSize: 'Thermal80' }));
        await waitFor(() => expect(result.current.paperSize).toBe('Thermal80'));

        await act(async () => {
            resolveShop({ default_paper_size: 'Letter' });
        });

        expect(result.current.paperSize).toBe('Thermal80');
    });

    it('skip preview: stored value wins over the profile, whichever way', () => {
        hydrateProfile({ skipPreview: true });
        localStorage.setItem(SKIP_KEY, 'false');
        expect(renderHook(() => useSalePrintPrefs()).result.current.skipPreview).toBe(false);

        hydrateProfile({ skipPreview: false });
        localStorage.setItem(SKIP_KEY, 'true');
        expect(renderHook(() => useSalePrintPrefs()).result.current.skipPreview).toBe(true);
    });

    it('skip preview: profile applies when this browser stored nothing', () => {
        hydrateProfile({ skipPreview: true });

        expect(renderHook(() => useSalePrintPrefs()).result.current.skipPreview).toBe(true);
    });

    it('skip preview: false when neither has an answer', () => {
        hydrateProfile({});

        expect(renderHook(() => useSalePrintPrefs()).result.current.skipPreview).toBe(false);
    });

    it('density and text size: stored → profile → normal', () => {
        hydrateProfile({ printDensity: 'compact', printTypeScale: 'larger' });
        const profiled = renderHook(() => useSalePrintPrefs()).result.current;
        expect(profiled.density).toBe('compact');
        expect(profiled.typeScale).toBe('larger');

        localStorage.setItem('erp71:print:density', 'normal');
        localStorage.setItem('erp71:print:type-scale', 'large');
        const stored = renderHook(() => useSalePrintPrefs()).result.current;
        expect(stored.density).toBe('normal');
        expect(stored.typeScale).toBe('large');
    });

    it('density: a profile that arrives after mount is shown', () => {
        const { result } = renderHook(() => useSalePrintPrefs());
        expect(result.current.density).toBe('normal');

        act(() => hydrateProfile({ printDensity: 'compact' }));

        expect(result.current.density).toBe('compact');
    });

    it('nothing is written to localStorage when the profile value is used', async () => {
        const setItem = jest.spyOn(Storage.prototype, 'setItem');
        hydrateProfile({ paperSize: 'A5', skipPreview: true, printDensity: 'compact', printTypeScale: 'large' });

        const { result } = renderHook(() => useSalePrintPrefs());

        await waitFor(() => expect(result.current.paperSize).toBe('A5'));
        expect(result.current.skipPreview).toBe(true);
        expect(setItem).not.toHaveBeenCalled();
    });

    it('no profile device fields → today\'s behaviour exactly', async () => {
        getSalesSettings.mockResolvedValue({ default_paper_size: 'Letter' });
        hydrateProfile({ sidebarCollapsed: true });

        const { result } = renderHook(() => useSalePrintPrefs());

        await waitFor(() => expect(result.current.paperSize).toBe('Letter'));
        expect(result.current.skipPreview).toBe(false);
        expect(result.current.density).toBe('normal');
        expect(result.current.typeScale).toBe('normal');
    });

    it('with the preferences store not loaded → today\'s behaviour exactly', async () => {
        getSalesSettings.mockResolvedValue({ default_paper_size: 'Letter' });

        const { result } = renderHook(() => useSalePrintPrefs());

        await waitFor(() => expect(result.current.paperSize).toBe('Letter'));
        expect(result.current.skipPreview).toBe(false);
    });
});
