'use client';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BackupRestorePanel, { readBackupPreview } from './BackupRestorePanel';
import type { TenantRecord } from '../types';

const restoreAdminTenantBackup = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        downloadAdminTenantBackup: jest.fn(),
        restoreAdminTenantBackup: (...args: unknown[]) => restoreAdminTenantBackup(...args),
    },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../../../lib/localization/messages/en');
    return {
        useI18n: () => ({ t: enMessages }),
        formatMessage: (template: string, values: Record<string, string | number>) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
});

jest.mock('lucide-react', () => new Proxy({}, {
    get: () => () => <span data-testid="icon" />,
}));

const tenant = { id: 'tenant-1', name: 'Acme Traders' } as TenantRecord;

/** A plain-JSON backup; jsdom has no DecompressionStream, and the server takes either. */
function backupFile(tenantId: string, tenantName = 'Acme Traders') {
    const body = JSON.stringify({
        format: 'erp71.tenant-backup',
        version: 1,
        created_at: '2026-10-01T10:00:00.000Z',
        created_by: 'admin@erp71.com',
        tenant: { id: tenantId, name: tenantName },
        tenant_settings: {},
        tables: { Sale: [{ id: 's1' }, { id: 's2' }], Customer: [{ id: 'c1' }] },
    });
    return new File([body], 'backup.json', { type: 'application/json' });
}

async function chooseFile(file: File) {
    fireEvent.click(screen.getByText('Restore from backup'));
    fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });
}

describe('readBackupPreview', () => {
    it('reads the header of a backup', async () => {
        await expect(readBackupPreview(backupFile('tenant-1'))).resolves.toEqual({
            tenantId: 'tenant-1',
            tenantName: 'Acme Traders',
            createdAt: '2026-10-01T10:00:00.000Z',
            createdBy: 'admin@erp71.com',
            tables: 2,
            rows: 3,
        });
    });

    it('returns null for anything else', async () => {
        await expect(readBackupPreview(new File(['{"a":1}'], 'x.json'))).resolves.toBeNull();
        await expect(readBackupPreview(new File(['not json'], 'x.json'))).resolves.toBeNull();
    });
});

describe('BackupRestorePanel', () => {
    beforeEach(() => restoreAdminTenantBackup.mockReset());

    it('refuses a backup of another workspace before uploading it', async () => {
        render(<BackupRestorePanel tenant={tenant} onRestored={jest.fn()} />);
        await chooseFile(backupFile('tenant-2', 'Other Shop'));

        expect(await screen.findByText(/belongs to another workspace \(Other Shop\)/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Restore$/ })).toBeDisabled();
    });

    it('restores only once the workspace name is typed', async () => {
        restoreAdminTenantBackup.mockResolvedValue({
            backup_created_at: '2026-10-01T10:00:00.000Z',
            tables: 2,
            rows_deleted: 10,
            rows_restored: 3,
            rows_skipped: {},
            references_cleared: {},
            unknown_tables: [],
            unknown_columns: [],
        });
        const onRestored = jest.fn();
        render(<BackupRestorePanel tenant={tenant} onRestored={onRestored} />);
        const file = backupFile('tenant-1');
        await chooseFile(file);

        expect(await screen.findByText(/3 records in 2 tables/)).toBeInTheDocument();
        const restore = screen.getByRole('button', { name: /^Restore$/ });
        expect(restore).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Type Acme Traders to confirm'), { target: { value: 'Acme Traders' } });
        expect(restore).toBeEnabled();
        fireEvent.click(restore);

        await waitFor(() => expect(onRestored).toHaveBeenCalled());
        expect(restoreAdminTenantBackup).toHaveBeenCalledWith('tenant-1', file, 'Acme Traders');
    });
});
