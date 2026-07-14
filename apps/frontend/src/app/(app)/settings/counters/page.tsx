'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import { useState, useEffect } from 'react';
import { Monitor, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import { Button, Field, Input, PageShell, Select } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

type Counter = {
    id: string;
    name: string;
    counter_number: number;
    status: string;
    store_id: string;
};

export default function CountersPage() {
    const { t } = useI18n();
    const m = t.settingsExtras.counters;
    const [counters, setCounters] = useState<Counter[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [editCounter, setEditCounter] = useState<Counter | null>(null);
    const [saving, setSaving] = useState(false);

    const [name, setName] = useState('');
    const [counterNumber, setCounterNumber] = useState<number | ''>('');
    const [status, setStatus] = useState('ACTIVE');

    const storeId = typeof window !== 'undefined' ? (localStorage.getItem('store_id') || '') : '';

    useEffect(() => {
        if (storeId) loadCounters();
    }, [storeId]);

    const loadCounters = async () => {
        setLoading(true);
        try {
            const data = await api.getCounters(storeId);
            setCounters(Array.isArray(data) ? data : (data?.data ?? []));
        } catch {
            toast.error(m.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const openAdd = () => {
        setName('');
        setCounterNumber('');
        setStatus('ACTIVE');
        setShowAdd(true);
        setEditCounter(null);
    };

    const openEdit = (c: Counter) => {
        setName(c.name);
        setCounterNumber(c.counter_number);
        setStatus(c.status);
        setEditCounter(c);
        setShowAdd(true);
    };

    const handleSave = async () => {
        if (!name.trim() || counterNumber === '') {
            toast.error(m.nameRequired);
            return;
        }
        setSaving(true);
        try {
            if (editCounter) {
                await api.updateCounter(editCounter.id, { name: name.trim(), status });
                toast.success(m.updated);
            } else {
                await api.createCounter({ storeId, name: name.trim(), counterNumber: Number(counterNumber) });
                toast.success(m.created);
            }
            setShowAdd(false);
            await loadCounters();
        } catch (err: any) {
            toast.error(err?.message || m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm(m.deleteConfirm)) return;
        try {
            await api.deleteCounter(id);
            toast.success(m.deleted);
            await loadCounters();
        } catch (err: any) {
            toast.error(err?.message || m.deleteFailed);
        }
    };

    const handleToggleStatus = async (c: Counter) => {
        try {
            const newStatus = c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
            await api.updateCounter(c.id, { status: newStatus });
            toast.success(newStatus === 'ACTIVE' ? m.activated : m.deactivated);
            await loadCounters();
        } catch (err: any) {
            toast.error(err?.message || m.updateFailed);
        }
    };

    if (!storeId) {
        return (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                {m.noStore}
            </div>
        );
    }

    return (
        <PageShell maxWidth="full">
            <PageHeader
                title={m.title}
                subtitle={m.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    m.title,
                    'settings',
                )}
                actions={(
                    <Button icon={<Plus className="w-4 h-4" />} onClick={openAdd}>
                        {m.addCounter}
                    </Button>
                )}
            />

            <div className="mt-4">
                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8">
                        <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                    </div>
                ) : counters.length === 0 ? (
                    <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                        <Monitor className="w-12 h-12 mx-auto text-gray-200 mb-3" />
                        <p className="text-sm font-bold text-gray-400">{m.emptyTitle}</p>
                        <p className="text-xs text-gray-300 mt-1">{m.emptyDescription}</p>
                        <Button className="mt-4" size="sm" icon={<Plus className="w-3 h-3" />} onClick={openAdd}>
                            {m.addFirstCounter}
                        </Button>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 bg-gray-50">
                                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{m.columns.number}</th>
                                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{m.columns.name}</th>
                                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{m.columns.status}</th>
                                    <th className="px-5 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {counters.map((c) => (
                                    <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-5 py-3.5 font-bold text-gray-900">{c.counter_number}</td>
                                        <td className="px-5 py-3.5 font-semibold text-gray-800">{c.name}</td>
                                        <td className="px-5 py-3.5">
                                            <button
                                                onClick={() => handleToggleStatus(c)}
                                                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${
                                                    c.status === 'ACTIVE'
                                                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                                }`}
                                            >
                                                <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'ACTIVE' ? 'bg-green-500' : 'bg-gray-400'}`} />
                                                {c.status === 'ACTIVE' ? m.status.active : m.status.inactive}
                                            </button>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => openEdit(c)}
                                                    className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(c.id)}
                                                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add / Edit Modal */}
            {showAdd && (
                <ModalShell size="sm" onBackdropClick={() => setShowAdd(false)}>
                    <ModalHeader
                        title={editCounter ? m.modal.editTitle : m.modal.addTitle}
                        onClose={() => setShowAdd(false)}
                    />
                    <div className="p-6 space-y-4">
                        <Field label={m.modal.nameLabel}>
                            <Input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={m.modal.namePlaceholder}
                            />
                        </Field>
                        {!editCounter && (
                            <Field label={m.modal.numberLabel}>
                                <Input
                                    type="number"
                                    min="1"
                                    value={counterNumber}
                                    onChange={(e) => setCounterNumber(e.target.value === '' ? '' : parseInt(e.target.value))}
                                    placeholder={m.modal.numberPlaceholder}
                                />
                            </Field>
                        )}
                        {editCounter && (
                            <Field label={m.columns.status}>
                                <Select
                                    value={status}
                                    onChange={(e) => setStatus(e.target.value)}
                                >
                                    <option value="ACTIVE">Active</option>
                                    <option value="INACTIVE">Inactive</option>
                                </Select>
                            </Field>
                        )}
                    </div>
                    <ModalFooter>
                        <Button className="w-full" onClick={handleSave} disabled={saving} loading={saving}>
                            {saving ? m.modal.saving : editCounter ? m.modal.saveChanges : m.modal.create}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}
