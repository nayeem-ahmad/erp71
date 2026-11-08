import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminAuditLogsPage from './page';
import { setActiveTimeZone } from '@/lib/format';

jest.mock('@/lib/api', () => ({
    api: { getAdminAuditLogs: jest.fn() },
}));

jest.mock('@/lib/i18n', () => {
    const actual = jest.requireActual('@/lib/i18n');
    const { enMessages } = require('@/lib/localization/messages/en');
    return { ...actual, useI18n: () => ({ t: enMessages }) };
});

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

describe('AdminAuditLogsPage — completed-log before and after', () => {
    const { api } = require('@/lib/api');
    const notes = 'line one\n  indented  \n<img src=x onerror=alert(1)>';

    beforeEach(() => {
        jest.clearAllMocks();
        setActiveTimeZone('Asia/Dhaka');
    });

    it('shows the same before-and-after text the tenant page shows, still read-only', async () => {
        api.getAdminAuditLogs.mockResolvedValue({
            rows: [{
                id: 'audit-9',
                tenant_id: 'tenant-1',
                tenant_name: 'Dhaka Electronics',
                action: 'crm.activity_details_updated',
                entity: 'CrmActivity',
                entity_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                created_at: '2026-11-08T13:20:15.000Z',
                payload: {
                    status: 'DONE',
                    changes: {
                        notes: { from: notes, to: 'after' },
                        outcome: { from: '   kept spaces', to: null },
                    },
                },
                user: { id: 'u1', email: 'admin@example.com', name: 'Admin' },
            }],
            total: 1,
        });

        render(<AdminAuditLogsPage />);

        await waitFor(() => {
            expect(screen.getByText('Corrected the text of a completed activity')).toBeInTheDocument();
        });
        expect(screen.getAllByText('crm.activity_details_updated').length).toBeGreaterThan(1);
        expect(api.getAdminAuditLogs).toHaveBeenCalled();
        expect(api.updateCrmActivity).toBeUndefined();

        fireEvent.click(screen.getByRole('button', { name: 'Before and after' }));

        expect(screen.getByTestId('activity-notes-before').textContent).toBe(notes);
        expect(screen.getByTestId('activity-notes-before').querySelector('img')).toBeNull();
        expect(screen.getByTestId('activity-outcome-before').textContent).toBe('   kept spaces');
        expect(screen.getByTestId('activity-outcome-after')).toHaveAttribute('data-kind', 'null');
        expect(screen.getByTestId('activity-summary-missing')).toHaveTextContent('Not in this audit');
        expect(screen.getByText(/2026-11-08T13:20:15\.000Z/)).toBeInTheDocument();
    });

    it('warns when the payload was truncated instead of showing a partial original', async () => {
        api.getAdminAuditLogs.mockResolvedValue({
            rows: [{
                id: 'audit-9',
                action: 'crm.activity_details_updated',
                entity: 'CrmActivity',
                entity_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                created_at: '2026-11-08T13:20:15.000Z',
                payload: { _truncated: true, changes: { notes: { from: 'SECRET ORIGINAL', to: 'x' } } },
                user: null,
            }],
            total: 1,
        });

        render(<AdminAuditLogsPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Before and after' }));

        expect(screen.getByRole('alert')).toHaveTextContent(/does not contain the before-and-after text/);
        expect(screen.queryByText('SECRET ORIGINAL')).not.toBeInTheDocument();
    });
});