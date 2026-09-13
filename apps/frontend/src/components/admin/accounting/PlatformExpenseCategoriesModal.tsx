'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Input, Select, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import type { PlatformAccount, PlatformExpenseCategory } from './types';

interface CategoryForm {
    id: string | null;
    name: string;
    accountName: string;
    description: string;
}

const EMPTY: CategoryForm = { id: null, name: '', accountName: '', description: '' };

/**
 * Manage the kinds of platform spend, and the account each posts to.
 *
 * The account is the part that matters: it is what turns a flat list of
 * payments into a profit & loss with lines on it. Only expense accounts are
 * offered, because the server refuses anything else — an option that always
 * fails to save is worse than no option.
 */
export default function PlatformExpenseCategoriesModal({
    categories,
    onClose,
    onChanged,
}: Readonly<{
    categories: PlatformExpenseCategory[];
    onClose: () => void;
    onChanged: () => Promise<void> | void;
}>) {
    const { t } = useI18n();
    const m = t.admin.accounting.categories;

    const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
    const [form, setForm] = useState<CategoryForm | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);

    const loadAccounts = useCallback(async () => {
        try {
            setAccounts(await api.getPlatformAccountingAccounts({ type: 'expense' }));
        } catch {
            // The list still renders; saving reports the real problem.
        }
    }, []);

    useEffect(() => {
        void loadAccounts();
    }, [loadAccounts]);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form) return;

        setSaving(true);
        setError('');
        try {
            const payload = {
                name: form.name,
                accountName: form.accountName,
                description: form.description || undefined,
            };
            if (form.id) {
                await api.updatePlatformExpenseCategory(form.id, payload);
            } else {
                await api.createPlatformExpenseCategory(payload);
            }
            toast.success(m.saved);
            setForm(null);
            await onChanged();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (category: PlatformExpenseCategory) => {
        setBusyId(category.id);
        try {
            const result = await api.deletePlatformExpenseCategory(category.id);
            // The server retires rather than deletes a category that has
            // expenses filed under it, so the message has to follow what it
            // actually did rather than what was asked.
            toast.success(result?.retired ? m.retiredNotice : m.deleted);
            await onChanged();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.saveFailed);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <ModalShell size="lg" onBackdropClick={onClose}>
            <ModalHeader title={m.title} subtitle={m.description} onClose={onClose} />

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                {form ? (
                    <form onSubmit={save} className="mb-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-gray-500">{m.name}</span>
                                <Input
                                    value={form.name}
                                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                                    required
                                    minLength={2}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-gray-500">{m.account}</span>
                                <Select
                                    value={form.accountName}
                                    onChange={(event) => setForm({ ...form, accountName: event.target.value })}
                                    required
                                >
                                    <option value="" disabled>—</option>
                                    {accounts.map((account) => (
                                        <option key={account.id} value={account.name}>
                                            {account.code ? `${account.code} · ` : ''}{account.name}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                        </div>
                        {error ? <p className="text-xs text-red-600">{error}</p> : null}
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setForm(null)}>{m.cancel}</Button>
                            <Button type="submit" loading={saving}>{saving ? m.saving : m.save}</Button>
                        </div>
                    </form>
                ) : (
                    <div className="mb-3 flex justify-end">
                        <Button onClick={() => { setError(''); setForm({ ...EMPTY }); }} icon={<Plus className="h-4 w-4" />}>
                            {m.add}
                        </Button>
                    </div>
                )}

                <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full min-w-[38rem] text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 bg-gray-50/80 text-xs font-medium text-gray-500">
                                <th className="px-2 py-1.5 text-start">{m.name}</th>
                                <th className="px-2 py-1.5 text-start">{m.account}</th>
                                <th className="px-2 py-1.5 text-end">{m.used}</th>
                                <th className="px-2 py-1.5 text-start">{m.status}</th>
                                <th className="px-2 py-1.5" />
                            </tr>
                        </thead>
                        <tbody>
                            {categories.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-6 text-center text-xs text-gray-400">{m.empty}</td>
                                </tr>
                            ) : null}
                            {categories.map((category) => (
                                <tr key={category.id} className="border-b border-gray-100 last:border-0">
                                    <td className="px-2 py-1.5">{category.name}</td>
                                    <td className="px-2 py-1.5 text-gray-600">{category.account_name}</td>
                                    <td className="px-2 py-1.5 text-end">{category._count?.expenses ?? 0}</td>
                                    <td className="px-2 py-1.5">
                                        <StatusBadge tone={category.is_active ? 'success' : 'neutral'}>
                                            {category.is_active ? m.active : m.retired}
                                        </StatusBadge>
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-1.5 text-end">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setError('');
                                                setForm({
                                                    id: category.id,
                                                    name: category.name,
                                                    accountName: category.account_name,
                                                    description: category.description ?? '',
                                                });
                                            }}
                                            className="me-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                            aria-label={m.edit}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => remove(category)}
                                            disabled={busyId === category.id}
                                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                                            aria-label={m.deleteTitle}
                                        >
                                            {busyId === category.id ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Trash2 className="h-4 w-4" />
                                            )}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <p className="mt-3 text-xs text-gray-400">{m.deleteBody}</p>
            </div>

            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>{m.cancel}</Button>
            </ModalFooter>
        </ModalShell>
    );
}
