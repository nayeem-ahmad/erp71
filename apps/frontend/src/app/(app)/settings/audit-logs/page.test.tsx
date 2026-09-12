import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuditLogsPage from './page';
import { ApiError } from '@/lib/api';

jest.mock('@/lib/api', () => {
    class ApiError extends Error {
        constructor(message: string, public readonly status: number) {
            super(message);
            this.name = 'ApiError';
        }
    }
    return {
        ApiError,
        api: { getAuditLogs: jest.fn() },
    };
});

jest.mock('@/lib/i18n', () => {
    const actual = jest.requireActual('@/lib/i18n');
    const { enMessages } = require('@/lib/localization/messages/en');
    // DataTable pulls formatMessage from the same module, so keep the real one.
    return { ...actual, useI18n: () => ({ t: enMessages }) };
});

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

describe('AuditLogsPage', () => {
    const { api } = require('@/lib/api');
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    const saleRow = {
        id: 'a1',
        action: 'sales.create',
        entity: 'sales',
        entity_id: '8f0e1c2d-3a4b-5c6d-7e8f-9a0b1c2d3e4f',
        ip_address: '203.0.113.9',
        created_at: '2026-08-01T10:00:00.000Z',
        payload: { invoice_number: 'INV-1042', payment_method: 'Cash' },
        user: { id: 'u1', email: 'owner@example.com', name: 'Owner' },
    };

    it('describes each row in plain English rather than showing the raw action', async () => {
        api.getAuditLogs.mockResolvedValue({ rows: [saleRow], total: 1 });

        render(<AuditLogsPage />);

        await waitFor(() => {
            expect(screen.getByText('Recorded a sale — INV-1042')).toBeInTheDocument();
        });
        expect(screen.getByText('Owner')).toBeInTheDocument();
        expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    });

    it('keeps technical identifiers off the tenant page', async () => {
        api.getAuditLogs.mockResolvedValue({ rows: [saleRow], total: 1 });

        render(<AuditLogsPage />);

        await waitFor(() => {
            expect(screen.getByText('Recorded a sale — INV-1042')).toBeInTheDocument();
        });
        // The raw action, the entity name and the row's UUID were all on this
        // page before and are what made it unreadable.
        expect(screen.queryByText('sales.create')).not.toBeInTheDocument();
        expect(screen.queryByText('sales')).not.toBeInTheDocument();
        expect(
            screen.queryByText('8f0e1c2d-3a4b-5c6d-7e8f-9a0b1c2d3e4f'),
        ).not.toBeInTheDocument();
        // The IP column is kept for desktop ("who signed in, and from where"
        // is a real question) but carries `hideOnMobile`, and jsdom reports a
        // narrow viewport — so its absence here is the mobile rule working,
        // not the column being dropped.
    });

    it('reveals readable details on demand, without exposing internal keys', async () => {
        api.getAuditLogs.mockResolvedValue({ rows: [saleRow], total: 1 });

        render(<AuditLogsPage />);

        await waitFor(() => {
            expect(screen.getByText('Recorded a sale — INV-1042')).toBeInTheDocument();
        });

        expect(screen.queryByText('Payment method')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /details/i }));

        expect(screen.getByText('Payment method')).toBeInTheDocument();
        expect(screen.getByText('Cash')).toBeInTheDocument();
    });

    it('shows the restricted panel on a 403 regardless of the server wording', async () => {
        // The page used to sniff for the substring 'OWNER or MANAGER'; the
        // backend says something else entirely, so the status is what counts.
        api.getAuditLogs.mockRejectedValue(
            new ApiError('You do not have permission to view audit logs', 403),
        );

        render(<AuditLogsPage />);

        await waitFor(() => {
            expect(screen.getByText('Audit logs restricted')).toBeInTheDocument();
        });
        expect(consoleError).not.toHaveBeenCalled();
    });

    it('does not show the restricted panel for a non-403 failure', async () => {
        api.getAuditLogs.mockRejectedValue(new ApiError('Internal server error', 500));

        render(<AuditLogsPage />);

        await waitFor(() => {
            expect(consoleError).toHaveBeenCalled();
        });
        expect(screen.queryByText('Audit logs restricted')).not.toBeInTheDocument();
    });
});
