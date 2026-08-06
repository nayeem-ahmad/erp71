import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

    it('renders the returned audit rows', async () => {
        api.getAuditLogs.mockResolvedValue({
            rows: [
                {
                    id: 'a1',
                    action: 'sales.create',
                    entity: 'sales',
                    entity_id: 'sale-1',
                    ip_address: '203.0.113.9',
                    created_at: '2026-08-01T10:00:00.000Z',
                    user: { id: 'u1', email: 'owner@example.com', name: 'Owner' },
                },
            ],
            total: 1,
        });

        render(<AuditLogsPage />);

        await waitFor(() => {
            expect(screen.getByText('sales.create')).toBeInTheDocument();
        });
        expect(screen.getByText('owner@example.com')).toBeInTheDocument();
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
