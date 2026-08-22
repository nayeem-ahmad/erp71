'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, ConfirmDialog, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

type Category = { id: string; slug: string; name: string; sort_order: number };

export default function StorefrontBlogCategoriesPage() {
    const { t } = useI18n();
    const m = t.storefront.blog;

    const [rows, setRows] = useState<Category[]>([]);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<Category | null>(null);

    const load = useCallback(async () => {
        try {
            const data = await api.getTenantBlogCategories();
            setRows(Array.isArray(data) ? data : []);
        } catch (error) {
            toast.error((error as Error).message);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function add() {
        if (!name.trim()) return;
        setSaving(true);
        try {
            await api.createTenantBlogCategory({ name: name.trim() });
            setName('');
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
                <PageHeader title={m.categories} subtitle={m.subtitle} />

                <Link href="/settings/blog" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {m.back}
                </Link>

                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <Field label={m.categoryName} className="flex-1 min-w-[12rem]">
                        <Input value={name} onChange={(event) => setName(event.target.value)} />
                    </Field>
                    <Button onClick={add} loading={saving} icon={<Plus className="h-4 w-4" />} disabled={!name.trim()}>
                        {m.addCategory}
                    </Button>
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full border-collapse text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-2 text-start text-xs font-semibold text-gray-600">{m.categoryName}</th>
                                <th className="px-3 py-2 text-end text-xs font-semibold text-gray-600" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr>
                                    <td colSpan={2} className="px-3 py-6 text-center text-xs text-gray-500">
                                        {m.noCategories}
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.id} className="border-t border-gray-100">
                                        <td className="px-3 py-2">
                                            <span className="font-medium text-gray-900">{row.name}</span>
                                            <div className="text-xs text-gray-500">/{row.slug}</div>
                                        </td>
                                        <td className="px-3 py-2 text-end">
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
                prompt={m.deleteCategoryConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                onCancel={() => setPendingDelete(null)}
                onConfirm={async () => {
                    const target = pendingDelete;
                    setPendingDelete(null);
                    if (!target) return;
                    try {
                        await api.deleteTenantBlogCategory(target.id);
                        await load();
                    } catch (error) {
                        toast.error((error as Error).message);
                    }
                }}
            />
        </PageShell>
    );
}
