import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuditLogsPage from './page';
import { ApiError } from '@/lib/api';
import { setActiveTimeZone } from '@/lib/format';

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

    const notes = 'line one\n  indented  \n<img src=x onerror=alert(1)>';
    const correction = {
        id: 'audit-1',
        action: 'crm.activity_details_updated',
        entity: 'CrmActivity',
        entity_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        created_at: '2026-11-08T13:20:15.000Z',
        ip_address: '203.0.113.9',
        payload: {
            status: 'DONE',
            changes: {
                notes: { from: notes, to: '=HYPERLINK("http://evil")' },
                summary: { from: null, to: '' },
            },
        },
        user: { id: 'u1', email: 'owner@example.com', name: 'Owner' },
    };

    it('shows the before-and-after text, and not a request-body row, without executing markup', async () => {
        setActiveTimeZone('Asia/Dhaka');
        api.getAuditLogs.mockResolvedValue({
            rows: [
                correction,
                {
                    id: 'audit-2',
                    action: 'crm.activities.update',
                    entity: 'crm',
                    entity_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                    created_at: '2026-11-08T13:20:16.000Z',
                    payload: { notes: '<img src=x onerror=alert(1)>' },
                    user: { id: 'u1', email: 'owner@example.com', name: 'Owner' },
                },
            ],
            total: 2,
        });

        render(<AuditLogsPage />);

        await waitFor(() => {
            expect(screen.getByText('Corrected the text of a completed activity')).toBeInTheDocument();
        });
        expect(screen.getByText('Updated crm activities')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Before and after' })).toHaveLength(1);
        expect(screen.getByText('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBeInTheDocument();
        expect(screen.getByText('audit-1')).toBeInTheDocument();
        expect(screen.getByText(/2026-11-08T13:20:15\.000Z/)).toBeInTheDocument();
        expect(screen.getByText(/Asia\/Dhaka/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Before and after' }));

        expect(screen.getByTestId('activity-notes-before').textContent).toBe(notes);
        expect(screen.getByTestId('activity-notes-after').textContent).toBe('=HYPERLINK("http://evil")');
        expect(screen.getByTestId('activity-summary-before')).toHaveAttribute('data-kind', 'null');
        expect(screen.getByTestId('activity-summary-after')).toHaveAttribute('data-kind', 'empty');
        expect(screen.getByTestId('activity-outcome-missing')).toHaveTextContent('Not in this audit');
        expect(document.querySelector('img')).toBeNull();
        expect(api.getAuditLogs).toHaveBeenCalled();
    });

    it('does not show truncated before-and-after text as the original', async () => {
        api.getAuditLogs.mockResolvedValue({
            rows: [{
                ...correction,
                payload: {
                    _truncated: true,
                    _bytes: 9000,
                    changes: { notes: { from: 'SECRET ORIGINAL', to: 'x' } },
                },
            }],
            total: 1,
        });

        render(<AuditLogsPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Before and after' }));

        expect(screen.getByRole('alert')).toHaveTextContent(/does not contain the before-and-after text/);
        expect(screen.queryByText('SECRET ORIGINAL')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-notes-before')).not.toBeInTheDocument();
    });
});
