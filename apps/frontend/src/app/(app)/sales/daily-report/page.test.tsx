'use client';
jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return {
        useI18n: () => ({
            t: enMessages,
            locale: 'en',
        }),
        formatMessage: (template: string, values: Record<string, string | number> = {}) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
}, { virtual: true });

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DailyReportPage from './page';
import type { DailyReport } from '@/lib/daily-report';

const quietPayload: DailyReport = {
    tenantName: 'Karim Electronics',
    storeName: 'Main',
    date: '2026-10-01',
    timezone: 'Asia/Dhaka',
    generatedAt: '2026-10-01T15:18:00.000Z',
    asOf: '2026-10-01T15:18:00.000Z',
    firstSaleAt: '2026-10-01T03:12:00.000Z',
    lastSaleAt: '2026-10-01T14:40:00.000Z',
    headlines: {
        netSales: 38000,
        cashMovement: 12000,
        newDues: 5000,
        vsPreviousPct: 8.5,
    },
    sales: {
        bills: 12,
        gross: 40000,
        returnsAmount: 2000,
        returnsCount: 1,
        net: 38000,
        avgBill: 3166.67,
    },
    tenders: [
        { method: 'CASH', amount: 20000 },
        { method: 'BKASH', amount: 15000 },
        { method: 'Credit', amount: 5000 },
    ],
    till: {
        sessions: [],
        rollup: {
            openingCash: 0,
            cashTakings: 20000,
            refunds: 0,
            cashIn: 0,
            cashOut: 0,
            expectedCash: 20000,
            closingCash: null,
            variance: null,
        },
        openSessionCount: 0,
        unassignedSalesCount: 0,
    },
    moneyOut: {
        purchases: { count: 0, net: 0 },
        paidToSuppliers: 0,
        expenses: { count: 0, amount: 0 },
    },
    dues: {
        newDues: 5000,
        collected: 0,
        accountsReceivable: 18000,
        accountsPayable: 9000,
    },
    topProducts: [{ name: 'USB-C cable', units: 8, revenue: 2400 }],
    returns: { rows: [], moreCount: 0 },
    stock: null,
    checklist: [],
    whatsappText: 'Karim Electronics · Main · 1 Oct\nNo sales\nAs of 9:18 pm',
};

const openPrintWindow = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getDailyReport: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/daily-report',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/lib/print', () => {
    const actual = jest.requireActual('@/lib/print') as Record<string, unknown>;
    return {
        ...actual,
        openPrintWindow: (...args: unknown[]) => openPrintWindow(...args),
        renderHeaderHtml: jest.fn(() => '<div class="letterhead"></div>'),
    };
});

jest.mock('@/lib/print/use-print-header', () => ({
    usePrintHeader: () => ({
        headerConfig: {},
        companyName: 'Karim Electronics',
        resolve: jest.fn().mockResolvedValue({
            headerConfig: {},
            companyName: 'Karim Electronics',
            resolve: jest.fn(),
        }),
    }),
}));

jest.mock('@/lib/hooks/useSalePrintPrefs', () => ({
    useSalePrintPrefs: () => ({
        paperSize: 'A4',
        skipPreview: false,
        setPaperSize: jest.fn(),
        setSkipPreview: jest.fn(),
        density: 'normal',
        setDensity: jest.fn(),
    }),
}));

describe('DailyReportPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getDailyReport.mockResolvedValue(quietPayload);
    });

    it('unmounts empty blocks and wires Print and Share', async () => {
        const { api } = require('@/lib/api');
        api.getDailyReport.mockResolvedValue(quietPayload);
        render(<DailyReportPage />);
        await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument());
        expect(screen.getByRole('heading', { name: /Daily Report/i })).toBeInTheDocument();
        expect(screen.queryByText(/Stock/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();
    });

    it('opens print with DAILY_REPORT letterhead', async () => {
        render(<DailyReportPage />);
        await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /print/i }));
        await waitFor(() => expect(openPrintWindow).toHaveBeenCalled());
        expect(openPrintWindow.mock.calls[0][0].paperSize).toBe('A4');
        expect(openPrintWindow.mock.calls[0][0].headerHtml).toContain('letterhead');
        expect(openPrintWindow.mock.calls[0][0].bodyHtml).toMatch(/Sales/);
    });

    it('opens share with server whatsappText', async () => {
        render(<DailyReportPage />);
        await waitFor(() => expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /share/i }));
        expect(screen.getByRole('textbox')).toHaveValue(quietPayload.whatsappText);
    });
});
