import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PagePerformancePanel from './PagePerformancePanel';

jest.mock('@/lib/api', () => ({
    api: { getPageTimingSummary: jest.fn() },
}));

import { api } from '@/lib/api';

const getSummary = api.getPageTimingSummary as jest.Mock;

const stats = {
    views: 1240,
    p50_ms: 420,
    p75_ms: 800,
    p95_ms: 3400,
    document_ms: null,
    boot_ms: 60,
    data_ms: 300,
    render_ms: 60,
    network_ms: 70,
    server_ms: 220,
    db_ms: 180,
    api_calls: 2,
};

describe('PagePerformancePanel', () => {
    beforeEach(() => {
        getSummary.mockReset();
    });

    it('lists pages with their percentiles, phase medians and usual slowest call', async () => {
        getSummary.mockResolvedValue({
            days: 7,
            nav_type: null,
            overall: stats,
            routes: [{ ...stats, route: '/sales/:id', views: 900, slowest_endpoint: 'GET /sales/:id' }],
        });

        render(<PagePerformancePanel />);

        expect(await screen.findByText('/sales/:id')).toBeInTheDocument();
        expect(getSummary).toHaveBeenCalledWith({ days: 7, navType: null });
        expect(screen.getByText('1,240')).toBeInTheDocument();
        expect(screen.getAllByText('3.40 s')[0]).toBeInTheDocument();
        expect(screen.getByText('GET /sales/:id')).toBeInTheDocument();
        expect(
            screen.getByRole('img', { name: 'App start / Route change 60 ms, Data 300 ms, Render 60 ms' }),
        ).toBeInTheDocument();
    });

    it('asks again for another window and page view type', async () => {
        getSummary.mockResolvedValue({ days: 7, nav_type: null, overall: { ...stats, views: 0 }, routes: [] });
        render(<PagePerformancePanel />);
        expect(await screen.findByText('No page views recorded in this window yet.')).toBeInTheDocument();

        fireEvent.change(screen.getByRole('combobox', { name: 'Time window' }), { target: { value: '30' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Page view type' }), { target: { value: 'load' } });

        await waitFor(() => expect(getSummary).toHaveBeenLastCalledWith({ days: 30, navType: 'load' }));
    });

    it('says so when the summary cannot be loaded', async () => {
        getSummary.mockRejectedValue(new Error('403'));
        render(<PagePerformancePanel />);
        expect(await screen.findByText('Could not load page performance')).toBeInTheDocument();
    });
});
