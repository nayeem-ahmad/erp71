'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, Field, Input, ConfirmDialog } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';

type Category = {
    id: string;
    slug: string;
    name_en: string;
    name_bn: string | null;
    name_ms: string | null;
    sort_order: number;
};

export default function AdminBlogCategoriesPage() {
    const { t } = useI18n();
    const m = t.admin.blog.categoryManager;

    const [rows, setRows] = useState<Category[]>([]);
    const [nameEn, setNameEn] = useState('');
    const [nameBn, setNameBn] = useState('');
    const [nameMs, setNameMs] = useState('');
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<Category | null>(null);

    const load = useCallback(async () => {
        try {
            const data = await api.getAdminBlogCategories();
            setRows(Array.isArray(data) ? data : []);
        } catch (error) {
            toast.error((error as Error).message);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function add() {
        if (!nameEn.trim()) return;
        setSaving(true);
        try {
            await api.createAdminBlogCategory({
                name_en: nameEn.trim(),
                name_bn: nameBn.trim() || undefined,
                name_ms: nameMs.trim() || undefined,
            });
            setNameEn('');
            setNameBn('');
            setNameMs('');
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={m.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        t.admin.blog.title,
                        'admin',
                    )}
                />

                <Link href="/admin/blog" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {t.admin.blog.editor.back}
                </Link>

                <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 md:grid-cols-4 md:p-4">
                    <Field label={m.name} required>
                        <Input value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
                    </Field>
                    <Field label={m.nameBn}>
                        <Input value={nameBn} onChange={(event) => setNameBn(event.target.value)} />
                    </Field>
                    <Field label={m.nameMs}>
                        <Input value={nameMs} onChange={(event) => setNameMs(event.target.value)} />
                    </Field>
                    <div className="flex items-end">
                        <Button onClick={add} loading={saving} icon={<Plus className="h-4 w-4" />} disabled={!nameEn.trim()}>
                            {m.add}
                        </Button>
                    </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full border-collapse text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">{m.name}</th>
                                <th className="hidden px-3 py-2 text-left text-xs font-semibold text-gray-600 md:table-cell">
                                    {m.nameBn}
                                </th>
                                <th className="hidden px-3 py-2 text-left text-xs font-semibold text-gray-600 md:table-cell">
                                    {m.nameMs}
                                </th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-500">
                                        {m.empty}
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.id} className="border-t border-gray-100">
                                        <td className="px-3 py-2">
                                            <span className="font-medium text-gray-900">{row.name_en}</span>
                                            <div className="text-xs text-gray-500">/{row.slug}</div>
                                        </td>
                                        <td className="hidden px-3 py-2 text-xs text-gray-600 md:table-cell">{row.name_bn ?? '—'}</td>
                                        <td className="hidden px-3 py-2 text-xs text-gray-600 md:table-cell">{row.name_ms ?? '—'}</td>
                                        <td className="px-3 py-2 text-right">
                                            <Button
                                                variant="ghost"
                                                icon={<Trash2 className="h-4 w-4" />}
                                                onClick={() => setPendingDelete(row)}
                                                aria-label={t.common.delete}
                                            />
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <ConfirmDialog
                open={!!pendingDelete}
                title={t.common.delete}
                prompt={m.deleteConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                onCancel={() => setPendingDelete(null)}
                onConfirm={async () => {
                    const target = pendingDelete;
                    setPendingDelete(null);
                    if (!target) return;
                    try {
                        await api.deleteAdminBlogCategory(target.id);
                        await load();
                    } catch (error) {
                        toast.error((error as Error).message);
                    }
                }}
            />
        </PageShell>
    );
}
