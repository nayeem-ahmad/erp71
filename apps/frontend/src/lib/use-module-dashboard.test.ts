import { renderHook, waitFor, act } from '@testing-library/react';
import { useModuleDashboard } from './use-module-dashboard';

jest.mock('./i18n', () => {
    const { enMessages } = require('./localization/messages/en');
    return { useI18n: () => ({ t: enMessages, locale: 'en' }) };
});

type Overview = { total: number };

describe('useModuleDashboard', () => {
    it('loads the window, its predecessor and the trend in one pass', async () => {
        const fetchOverview = jest.fn()
            .mockResolvedValueOnce({ total: 10 })
            .mockResolvedValueOnce({ total: 5 });
        const fetchTrends = jest.fn().mockResolvedValue({ points: [{ v: 1 }, { v: 2 }] });

        const { result } = renderHook(() => useModuleDashboard<Overview, { v: number }>({
            fetchOverview,
            fetchTrends,
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.overview).toEqual({ total: 10 });
        expect(result.current.previous).toEqual({ total: 5 });
        expect(result.current.trends).toHaveLength(2);
        expect(result.current.error).toBe('');
        // Current window first, comparison window second.
        expect(fetchOverview).toHaveBeenCalledTimes(2);
    });

    it('keeps the page when only the comparison window and trend fail', async () => {
        const fetchOverview = jest.fn()
            .mockResolvedValueOnce({ total: 10 })
            .mockRejectedValueOnce(new Error('nope'));
        const fetchTrends = jest.fn().mockRejectedValue(new Error('nope'));

        const { result } = renderHook(() => useModuleDashboard<Overview, never>({
            fetchOverview,
            fetchTrends,
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.overview).toEqual({ total: 10 });
        expect(result.current.previous).toBeNull();
        expect(result.current.trends).toEqual([]);
        expect(result.current.error).toBe('');
    });

    it('surfaces the overview failure, and only that one', async () => {
        const fetchOverview = jest.fn().mockRejectedValue(new Error('module is down'));

        const { result } = renderHook(() => useModuleDashboard<Overview, never>({
            fetchOverview,
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.overview).toBeNull();
        expect(result.current.error).toBe('module is down');
    });

    it('falls back to the supplied message when the rejection carries none', async () => {
        const fetchOverview = jest.fn().mockRejectedValue('not an Error');

        const { result } = renderHook(() => useModuleDashboard<Overview, never>({
            fetchOverview,
            unavailableMessage: 'Inventory figures are unavailable right now.',
        }));

        await waitFor(() => expect(result.current.error).toBe('Inventory figures are unavailable right now.'));
    });

    it('reloads on a range change, and re-reads the fetcher rather than the one it mounted with', async () => {
        const fetchOverview = jest.fn().mockResolvedValue({ total: 1 });

        const { result } = renderHook(() => useModuleDashboard<Overview, never>({
            fetchOverview,
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(fetchOverview).toHaveBeenCalledTimes(2);

        act(() => result.current.setRange('today'));

        await waitFor(() => expect(fetchOverview).toHaveBeenCalledTimes(4));
        // Inline arrow fetchers change identity every render; depending on them
        // would have reloaded forever instead of twice.
        expect(fetchOverview).toHaveBeenCalledTimes(4);
    });

    it('treats a missing figure on either side as no comparison, not as a fall to zero', async () => {
        const { result } = renderHook(() => useModuleDashboard<Overview, never>({
            fetchOverview: jest.fn().mockResolvedValue({ total: 1 }),
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.compare(10, null)).toEqual({ label: '—', positive: true });
        expect(result.current.compare(undefined, 10)).toEqual({ label: '—', positive: true });
        expect(result.current.compare(12, 10)).toEqual({ label: '▲ 20%', positive: true });
    });

    it('names the comparison window so a delta means something', async () => {
        const { result } = renderHook(() => useModuleDashboard<Overview, never>({
            fetchOverview: jest.fn().mockResolvedValue({ total: 1 }),
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.deltaContext).toBe('vs last month');

        act(() => result.current.setRange('week'));
        await waitFor(() => expect(result.current.deltaContext).toBe('vs last week'));
    });
});
