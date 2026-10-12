import { waitFor, act } from '@testing-library/react';
import { renderHookWithQueryClient } from '@/test-utils/query-client';
import { useModuleDashboard } from './use-module-dashboard';

jest.mock('./i18n', () => {
    const { enMessages } = require('./localization/messages/en');
    return { useI18n: () => ({ t: enMessages, locale: 'en' }) };
});

type Overview = { total: number };

describe('useModuleDashboard', () => {
    it('loads the window, its predecessor and the trend', async () => {
        const fetchOverview = jest.fn()
            .mockResolvedValueOnce({ total: 10 })
            .mockResolvedValueOnce({ total: 5 });
        const fetchTrends = jest.fn().mockResolvedValue({ points: [{ v: 1 }, { v: 2 }] });

        const { result } = renderHookWithQueryClient(() => useModuleDashboard<Overview, { v: number }>({
            cacheKey: 'test',
            fetchOverview,
            fetchTrends,
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        // Three requests of their own now, so the comparison and the trend may
        // land a beat after the headline figures.
        await waitFor(() => expect(result.current.previous).toEqual({ total: 5 }));
        await waitFor(() => expect(result.current.trends).toHaveLength(2));

        expect(result.current.overview).toEqual({ total: 10 });
        expect(result.current.error).toBe('');
        // Current window first, comparison window second.
        expect(fetchOverview).toHaveBeenCalledTimes(2);
    });

    it('keeps the page when only the comparison window and trend fail', async () => {
        const fetchOverview = jest.fn()
            .mockResolvedValueOnce({ total: 10 })
            .mockRejectedValueOnce(new Error('nope'));
        const fetchTrends = jest.fn().mockRejectedValue(new Error('nope'));

        const { result } = renderHookWithQueryClient(() => useModuleDashboard<Overview, never>({
            cacheKey: 'test',
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

        const { result } = renderHookWithQueryClient(() => useModuleDashboard<Overview, never>({
            cacheKey: 'test',
            fetchOverview,
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.overview).toBeNull();
        expect(result.current.error).toBe('module is down');
    });

    it('falls back to the supplied message when the rejection carries none', async () => {
        const fetchOverview = jest.fn().mockRejectedValue('not an Error');

        const { result } = renderHookWithQueryClient(() => useModuleDashboard<Overview, never>({
            cacheKey: 'test',
            fetchOverview,
            unavailableMessage: 'Inventory figures are unavailable right now.',
        }));

        await waitFor(() => expect(result.current.error).toBe('Inventory figures are unavailable right now.'));
    });

    it('reloads on a range change, and re-reads the fetcher rather than the one it mounted with', async () => {
        const fetchOverview = jest.fn().mockResolvedValue({ total: 1 });

        const { result } = renderHookWithQueryClient(() => useModuleDashboard<Overview, never>({
            cacheKey: 'test',
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
        const { result } = renderHookWithQueryClient(() => useModuleDashboard<Overview, never>({
            cacheKey: 'test',
            fetchOverview: jest.fn().mockResolvedValue({ total: 1 }),
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.compare(10, null)).toEqual({ label: '—', positive: true });
        expect(result.current.compare(undefined, 10)).toEqual({ label: '—', positive: true });
        expect(result.current.compare(12, 10)).toEqual({ label: '▲ 20%', positive: true });
    });

    it('names the comparison window so a delta means something', async () => {
        const { result } = renderHookWithQueryClient(() => useModuleDashboard<Overview, never>({
            cacheKey: 'test',
            fetchOverview: jest.fn().mockResolvedValue({ total: 1 }),
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.deltaContext).toBe('vs last month');

        act(() => result.current.setRange('week'));
        await waitFor(() => expect(result.current.deltaContext).toBe('vs last week'));
    });

    it('shows the current window without waiting for the comparison window', async () => {
        // The first call is this window; the second, the one before it, never answers.
        const fetchOverview = jest.fn()
            .mockResolvedValueOnce({ total: 10 })
            .mockImplementationOnce(() => new Promise(() => undefined));

        const { result } = renderHookWithQueryClient(() => useModuleDashboard<Overview, never>({
            cacheKey: 'test',
            fetchOverview,
            unavailableMessage: 'unavailable',
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.overview).toEqual({ total: 10 });
        // No arrow yet, rather than no page yet.
        expect(result.current.previous).toBeNull();
        expect(result.current.compare(10, result.current.previous?.total)).toEqual({ label: '—', positive: true });
    });

    it('keeps the last range on screen, marked refreshing, while the next one loads', async () => {
        const fetchOverview = jest.fn().mockResolvedValue({ total: 10 });

        const { result } = renderHookWithQueryClient(() => useModuleDashboard<Overview, never>({
            cacheKey: 'test',
            fetchOverview,
            unavailableMessage: 'unavailable',
        }));
        await waitFor(() => expect(result.current.previous).toEqual({ total: 10 }));

        fetchOverview.mockImplementation(() => new Promise(() => undefined));
        act(() => result.current.setRange('week'));

        await waitFor(() => expect(result.current.refreshing).toBe(true));
        expect(result.current.loading).toBe(false);
        expect(result.current.overview).toEqual({ total: 10 });
        // Both still the month's, so they may still be compared with each other.
        expect(result.current.previous).toEqual({ total: 10 });
    });

    it('answers a return visit from the cache', async () => {
        const fetchOverview = jest.fn().mockResolvedValue({ total: 7 });
        const options = { cacheKey: 'test', fetchOverview, unavailableMessage: 'unavailable' };

        const first = renderHookWithQueryClient(() => useModuleDashboard<Overview, never>(options));
        await waitFor(() => expect(first.result.current.loading).toBe(false));
        first.unmount();

        const second = renderHookWithQueryClient(() => useModuleDashboard<Overview, never>(options));

        expect(second.result.current.loading).toBe(false);
        expect(second.result.current.overview).toEqual({ total: 7 });
    });
});
