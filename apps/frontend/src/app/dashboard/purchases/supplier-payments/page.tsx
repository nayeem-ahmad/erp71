'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Search, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

type SupplierOption = {
    id: string;
    name: string;
    phone?: string | null;
    due_balance?: number | string;
};

function SupplierPaymentsContent() {
    const { t } = useI18n();
    const copy = t.supplierPayments;
    const searchParams = useSearchParams();
    const preselectedId = searchParams.get('supplierId');

    const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(preselectedId);
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    const loadSuppliers = useCallback(async () => {
        setLoading(true);
        try {
            const items = await api.getSuppliers();
            setSuppliers(Array.isArray(items) ? items : []);
        } catch (err) {
            console.error(err);
            setError(copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [copy.loadFailed]);

    useEffect(() => {
        void loadSuppliers();
    }, [loadSuppliers]);

    useEffect(() => {
        if (preselectedId) setSelectedId(preselectedId);
    }, [preselectedId]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return suppliers;
        return suppliers.filter(
            (s) => s.name.toLowerCase().includes(q) || (s.phone ?? '').includes(q),
        );
    }, [suppliers, search]);

    const selected = suppliers.find((s) => s.id === selectedId) ?? null;
    const dueBalance = selected ? Number(selected.due_balance ?? 0) : 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedId) return;
        const amt = parseFloat(amount);
        if (Number.isNaN(amt) || amt <= 0) {
            setError(copy.invalidAmount);
            return;
        }
        if (amt > dueBalance) {
            setError(copy.exceedsDue);
            return;
        }
        setSaving(true);
        setError('');
        setSuccess(false);
        try {
            await api.recordSupplierCreditPayment(selectedId, { amount: amt, notes: notes.trim() || undefined });
            setSuccess(true);
            setAmount('');
            setNotes('');
            await loadSuppliers();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#F0F2F5] p-4 md:p-8">
            <Link href="/dashboard/purchases" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-gray-900">
                <ArrowLeft className="h-4 w-4" />
                {copy.backToPurchases}
            </Link>

            <div className="mb-6">
                <h1 className="text-2xl font-black tracking-tight text-gray-900">{copy.title}</h1>
                <p className="mt-1 text-sm text-gray-500">{copy.subtitle}</p>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
                <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                    <label className="text-xs font-black uppercase tracking-widest text-gray-400">{copy.selectSupplier}</label>
                    <div className="relative mt-2">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={copy.searchPlaceholder}
                            className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-3 text-sm font-medium outline-none focus:border-blue-400"
                        />
                    </div>
                    <ul className="mt-4 max-h-80 space-y-1 overflow-y-auto">
                        {loading ? (
                            <li className="py-8 text-center text-sm text-gray-400">{copy.loading}</li>
                        ) : filtered.length === 0 ? (
                            <li className="py-8 text-center text-sm text-gray-400">{copy.noSuppliers}</li>
                        ) : (
                            filtered.map((s) => {
                                const due = Number(s.due_balance ?? 0);
                                const active = s.id === selectedId;
                                return (
                                    <li key={s.id}>
                                        <button
                                            type="button"
                                            onClick={() => { setSelectedId(s.id); setSuccess(false); setError(''); }}
                                            className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors ${
                                                active ? 'bg-[#FBE4D9] text-[#9a4a2e] ring-1 ring-[#f5cdb8]' : 'hover:bg-gray-50'
                                            }`}
                                        >
                                            <div>
                                                <p className="text-sm font-bold">{s.name}</p>
                                                {s.phone ? <p className="text-xs text-gray-500">{s.phone}</p> : null}
                                            </div>
                                            <span className={`text-sm font-black ${due > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                                                {formatBDT(due)}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })
                        )}
                    </ul>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                    {selected ? (
                        <>
                            <div className="mb-5 flex items-center gap-3 rounded-xl bg-[#FBE4D9] px-4 py-3">
                                <Wallet className="h-5 w-5 text-[#9a4a2e]" />
                                <div>
                                    <p className="text-sm font-bold text-gray-900">{selected.name}</p>
                                    <p className="text-xs text-gray-500">{copy.dueBalance}: <span className="font-black text-rose-600">{formatBDT(dueBalance)}</span></p>
                                </div>
                            </div>
                            {dueBalance <= 0 ? (
                                <p className="text-sm text-gray-500">{copy.noDue}</p>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="text-xs font-bold uppercase tracking-widest text-gray-500">{copy.amount}</label>
                                        <input
                                            type="number"
                                            min="0.01"
                                            step="0.01"
                                            max={dueBalance}
                                            value={amount}
                                            onChange={(e) => setAmount(e.target.value)}
                                            placeholder={copy.amountPlaceholder}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-orange-400"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold uppercase tracking-widest text-gray-500">{copy.notes}</label>
                                        <input
                                            type="text"
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            placeholder={copy.notesPlaceholder}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                                        />
                                    </div>
                                    {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}
                                    {success ? (
                                        <p className="flex items-center gap-2 text-sm font-bold text-emerald-700">
                                            <CheckCircle2 className="h-4 w-4" />
                                            {copy.paymentSaved}
                                        </p>
                                    ) : null}
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="w-full rounded-xl bg-[#293F75] py-2.5 text-sm font-bold text-white hover:bg-[#1f3058] disabled:opacity-60"
                                    >
                                        {saving ? copy.saving : copy.confirmPayment}
                                    </button>
                                    <Link
                                        href={`/dashboard/purchases/supplier-ledger?supplierId=${selected.id}`}
                                        className="block text-center text-xs font-bold text-orange-700 hover:underline"
                                    >
                                        {copy.viewLedger}
                                    </Link>
                                </form>
                            )}
                        </>
                    ) : (
                        <p className="py-12 text-center text-sm text-gray-400">{copy.pickSupplier}</p>
                    )}
                </section>
            </div>
        </div>
    );
}

export default function SupplierPaymentsPage() {
    const { t } = useI18n();
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500">{t.supplierPayments.loading}</div>}>
            <SupplierPaymentsContent />
        </Suspense>
    );
}