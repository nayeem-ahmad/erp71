'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, FolderLock, Pencil, Plus, Trash2 } from 'lucide-react';
import { documentExpiryState } from '@erp71/shared-types';
import { Alert, Button, ConfirmDialog, PageHeader, PageShell, SkeletonBar, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { DocumentFormModal } from '@/components/tools/documents/DocumentFormModal';
import type { BusinessDocument } from '@/components/tools/types';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';

/** Tools → Documents: the business's licences, with the date each runs out. */
export default function DocumentsPage() {
    const { t, fmt, locale } = useI18n();
    const m = t.tools.documents;
    const [documents, setDocuments] = useState<BusinessDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<BusinessDocument | null | 'new'>(null);
    const [deleting, setDeleting] = useState<BusinessDocument | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const rows = await api.getBusinessDocuments();
            setDocuments(Array.isArray(rows) ? rows : []);
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [m.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const states = useMemo(
        () => new Map(documents.map((doc) => [doc.id, documentExpiryState(doc.expiry_date, doc.remind_days_before)])),
        [documents],
    );
    const expired = documents.filter((doc) => states.get(doc.id)?.state === 'expired').length;
    const expiring = documents.filter((doc) => states.get(doc.id)?.state === 'expiring').length;

    const badge = (doc: BusinessDocument): { tone: StatusBadgeTone; text: string } => {
        const { state, daysLeft } = states.get(doc.id) ?? { state: 'none', daysLeft: null };
        if (state === 'expired') return { tone: 'danger', text: fmt(m.state.expired, { days: -(daysLeft ?? 0) }) };
        if (state === 'expiring') return { tone: 'warning', text: daysLeft === 0 ? m.state.expiringToday : fmt(m.state.expiring, { days: daysLeft ?? 0 }) };
        if (state === 'valid') return { tone: 'success', text: m.state.valid };
        return { tone: 'neutral', text: m.state.none };
    };

    const confirmDelete = async () => {
        if (!deleting) return;
        setBusy(true);
        try {
            await api.deleteBusinessDocument(deleting.id);
            toast.success(m.deleted);
            setDeleting(null);
            void load();
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.tools, m.title, 'tools')}
                actions={
                    <Button onClick={() => setEditing('new')}>
                        <Plus className="h-4 w-4" aria-hidden /> {m.newDocument}
                    </Button>
                }
            />

            {!loading && documents.length > 0 && (
                expired || expiring ? (
                    <Alert tone={expired ? 'danger' : 'warning'}>
                        {[expired ? fmt(m.expiredCount, { count: expired }) : null, expiring ? fmt(m.expiringCount, { count: expiring }) : null]
                            .filter(Boolean)
                            .join(' · ')}
                    </Alert>
                ) : (
                    <Alert tone="success">{m.allValid}</Alert>
                )
            )}

            <div className="rounded-md border border-gray-200 bg-white">
                {loading && documents.length === 0 ? (
                    <div className="space-y-2 p-3" aria-busy>
                        {[0, 1, 2].map((row) => (
                            <SkeletonBar key={row} className="h-8 w-full" />
                        ))}
                    </div>
                ) : documents.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
                        <FolderLock className="h-10 w-10 text-gray-200" aria-hidden />
                        <p className="text-sm text-gray-500">{m.empty}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                                <tr>
                                    <th className="px-3 py-2 text-start font-medium">{m.columns.document}</th>
                                    <th className="hidden px-3 py-2 text-start font-medium md:table-cell">{m.columns.number}</th>
                                    <th className="hidden px-3 py-2 text-start font-medium sm:table-cell">{m.columns.expiry}</th>
                                    <th className="hidden px-3 py-2 text-start font-medium sm:table-cell">{m.columns.file}</th>
                                    <th className="px-3 py-2 text-end font-medium">{m.columns.actions}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {documents.map((doc) => {
                                    const status = badge(doc);
                                    return (
                                        <tr key={doc.id} className="align-top">
                                            <td className="px-3 py-2">
                                                <div className="font-medium text-gray-900">{doc.title}</div>
                                                {(doc.title !== m.types[doc.doc_type] || doc.issuing_authority) && (
                                                    <div className="text-xs text-gray-500">
                                                        {[doc.title !== m.types[doc.doc_type] ? m.types[doc.doc_type] : null, doc.issuing_authority]
                                                            .filter(Boolean)
                                                            .join(' · ')}
                                                    </div>
                                                )}
                                                {doc.number && <div className="text-xs text-gray-500 md:hidden">{doc.number}</div>}
                                                <div className="mt-0.5 flex flex-wrap items-center gap-1 sm:hidden">
                                                    {doc.expiry_date && <span className="text-xs text-gray-700">{formatDate(doc.expiry_date, locale)}</span>}
                                                    <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
                                                </div>
                                            </td>
                                            <td className="hidden px-3 py-2 text-gray-700 md:table-cell">{doc.number ?? '—'}</td>
                                            <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">
                                                <div className="text-gray-900">{doc.expiry_date ? formatDate(doc.expiry_date, locale) : '—'}</div>
                                                <StatusBadge tone={status.tone} className="mt-0.5">{status.text}</StatusBadge>
                                            </td>
                                            <td className="hidden px-3 py-2 sm:table-cell">
                                                {doc.file_url ? (
                                                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                                                        <FileText className="h-4 w-4" aria-hidden /> {m.viewFile}
                                                    </a>
                                                ) : (
                                                    <span className="text-gray-400">{m.noFile}</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-end">
                                                    {doc.file_url && (
                                                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-touch items-center px-2 text-blue-600 sm:hidden" aria-label={m.viewFile}>
                                                            <FileText className="h-4 w-4" aria-hidden />
                                                        </a>
                                                    )}
                                                    <Button variant="ghost" size="sm" onClick={() => setEditing(doc)} aria-label={m.actions.edit} title={m.actions.edit}>
                                                        <Pencil className="h-4 w-4" aria-hidden />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => setDeleting(doc)} aria-label={m.actions.delete} title={m.actions.delete}>
                                                        <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {editing && (
                <DocumentFormModal
                    document={editing === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null);
                        void load();
                    }}
                />
            )}
            <ConfirmDialog
                open={!!deleting}
                title={m.deleteTitle}
                prompt={m.deletePrompt}
                confirmLabel={m.actions.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={() => void confirmDelete()}
                onCancel={() => setDeleting(null)}
            />
        </PageShell>
    );
}
