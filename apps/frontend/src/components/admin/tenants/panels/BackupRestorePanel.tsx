'use client';

import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import CompactSection from '@/components/ui/compact/CompactSection';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { TenantRecord } from '../types';

/** What the panel reads off a chosen file before anything is sent. */
export type BackupPreview = {
    tenantId: string;
    tenantName: string;
    createdAt: string;
    createdBy: string | null;
    tables: number;
    rows: number;
};

/** FileReader rather than `Blob.text()`, which older engines (and jsdom) lack. */
function readBlob(blob: Blob, as: 'text'): Promise<string>;
function readBlob(blob: Blob, as: 'buffer'): Promise<ArrayBuffer>;
function readBlob(blob: Blob, as: 'text' | 'buffer'): Promise<string | ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string | ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        if (as === 'text') reader.readAsText(blob);
        else reader.readAsArrayBuffer(blob);
    });
}

/**
 * Read a backup's header in the browser, so the admin sees which workspace and
 * which day they are about to restore — and is stopped before uploading another
 * workspace's file. Returns null for anything that is not an ERP71 backup.
 */
export async function readBackupPreview(file: Blob): Promise<BackupPreview | null> {
    try {
        const head = new Uint8Array(await readBlob(file.slice(0, 2), 'buffer'));
        const gzipped = head[0] === 0x1f && head[1] === 0x8b;
        const text = gzipped
            ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
            : await readBlob(file, 'text');
        const parsed = JSON.parse(text);
        if (parsed?.format !== 'erp71.tenant-backup' || typeof parsed.tenant?.id !== 'string') return null;
        const tables = Object.values(parsed.tables ?? {}) as unknown[][];
        return {
            tenantId: parsed.tenant.id,
            tenantName: String(parsed.tenant.name ?? ''),
            createdAt: String(parsed.created_at ?? ''),
            createdBy: parsed.created_by ?? null,
            tables: tables.length,
            rows: tables.reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0),
        };
    } catch {
        return null;
    }
}

function backupFileName(tenantName: string): string {
    const slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tenant';
    return `erp71-backup-${slug}-${new Date().toISOString().slice(0, 10)}.json.gz`;
}

type Props = {
    tenant: TenantRecord;
    /** Re-read the tenant after a restore: its settings and branches may have changed. */
    onRestored: () => void;
};

/**
 * Download a whole-workspace backup, or replace the workspace with one taken
 * earlier (`TenantBackupService`). The restore is confirmed by typing the
 * workspace name, like the other irreversible actions on this tab.
 */
export default function BackupRestorePanel({ tenant, onRestored }: Props) {
    const { t } = useI18n();
    const m = t.admin.tenants.backupRestore;

    const [downloading, setDownloading] = useState(false);
    const [open, setOpen] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<BackupPreview | null>(null);
    const [fileError, setFileError] = useState('');
    const [confirmText, setConfirmText] = useState('');
    const [restoring, setRestoring] = useState(false);
    const [error, setError] = useState('');

    const download = async () => {
        setDownloading(true);
        try {
            const { blob } = await api.downloadAdminTenantBackup(tenant.id);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            // Named here: a separate API host does not expose Content-Disposition.
            link.download = backupFileName(tenant.name);
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            toast.success(formatMessage(m.downloaded, { name: tenant.name }));
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.downloadFailed);
        } finally {
            setDownloading(false);
        }
    };

    const close = () => {
        if (restoring) return;
        setOpen(false);
        setFile(null);
        setPreview(null);
        setFileError('');
        setConfirmText('');
        setError('');
    };

    const choose = async (chosen: File | null) => {
        setFile(chosen);
        setPreview(null);
        setFileError('');
        setError('');
        if (!chosen) return;
        const read = await readBackupPreview(chosen);
        if (!read) {
            setFileError(m.fileInvalid);
        } else if (read.tenantId !== tenant.id) {
            setFileError(formatMessage(m.fileOtherTenant, { name: read.tenantName }));
        } else {
            setPreview(read);
        }
    };

    const nameMatches = confirmText.trim() === tenant.name.trim();

    const restore = async () => {
        if (!file || !preview || !nameMatches) return;
        setRestoring(true);
        setError('');
        try {
            const summary = await api.restoreAdminTenantBackup(tenant.id, file, confirmText.trim());
            const skipped = Object.values(summary.rows_skipped).reduce((n, c) => n + c, 0);
            toast.success(formatMessage(m.restored, {
                name: tenant.name,
                date: formatDateTime(summary.backup_created_at),
                rows: String(summary.rows_restored),
            }));
            if (skipped > 0) toast.info(formatMessage(m.restoredSkipped, { count: String(skipped) }));
            setRestoring(false);
            close();
            onRestored();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.restoreFailed);
            setRestoring(false);
        }
    };

    return (
        <CompactSection>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{m.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{m.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="secondary"
                        onClick={() => void download()}
                        disabled={downloading}
                        loading={downloading}
                        icon={<Download className="w-4 h-4" />}
                    >
                        {m.downloadButton}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => setOpen(true)}
                        icon={<Upload className="w-4 h-4" />}
                        className="!text-danger-text !border-red-200 hover:!bg-danger-light"
                    >
                        {m.restoreButton}
                    </Button>
                </div>
            </div>

            {open && (
                <ModalShell size="sm" onBackdropClick={close} dismissOnBackdrop={!restoring}>
                    <ModalHeader title={formatMessage(m.restoreTitle, { name: tenant.name })} onClose={restoring ? undefined : close} />
                    <div className="space-y-4 overflow-y-auto p-4">
                        <Alert tone="warning">{formatMessage(m.restoreWarning, { name: tenant.name })}</Alert>

                        <div className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                            <p className="text-xs text-gray-600">{m.downloadFirst}</p>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void download()}
                                disabled={downloading || restoring}
                                loading={downloading}
                                icon={<Download className="w-4 h-4" />}
                            >
                                {m.downloadButton}
                            </Button>
                        </div>

                        <Field label={m.fileLabel} hint={m.fileHint} error={fileError || undefined} htmlFor="tenant-backup-file">
                            <Input
                                id="tenant-backup-file"
                                type="file"
                                accept=".gz,.json,application/gzip,application/json"
                                onChange={(event) => void choose(event.target.files?.[0] ?? null)}
                                disabled={restoring}
                                className="w-full"
                            />
                        </Field>

                        {preview && (
                            <p className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                                {formatMessage(m.fileSummary, {
                                    date: formatDateTime(preview.createdAt),
                                    by: preview.createdBy ?? '—',
                                    rows: String(preview.rows),
                                    tables: String(preview.tables),
                                })}
                            </p>
                        )}

                        {preview && (
                            <Field
                                label={formatMessage(m.confirmLabel, { name: tenant.name })}
                                error={confirmText && !nameMatches ? m.confirmMismatch : undefined}
                                htmlFor="tenant-backup-confirm"
                            >
                                <Input
                                    id="tenant-backup-confirm"
                                    value={confirmText}
                                    onChange={(event) => setConfirmText(event.target.value)}
                                    disabled={restoring}
                                    autoComplete="off"
                                    className="w-full"
                                />
                            </Field>
                        )}

                        {restoring && <p className="text-xs text-gray-500">{m.restoring}</p>}
                        {error && <Alert tone="danger">{error}</Alert>}
                    </div>
                    <ModalFooter>
                        <Button variant="ghost" size="md" onClick={close} disabled={restoring}>
                            {t.common.cancel}
                        </Button>
                        <Button
                            variant="danger"
                            size="md"
                            onClick={() => void restore()}
                            disabled={!preview || !nameMatches || restoring}
                            loading={restoring}
                            icon={<Upload className="w-4 h-4" />}
                        >
                            {m.restoreConfirm}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </CompactSection>
    );
}
