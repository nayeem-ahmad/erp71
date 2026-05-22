'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, Search, ShieldCheck, Users } from 'lucide-react';
import { api } from '../../../../lib/api';
import { formatDate } from '../../../../lib/format';

type PlanCode = 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';

type TenantRecord = {
    id: string;
    name: string;
    created_at: string;
    owner: { id: string; email: string; name?: string | null } | null;
    stores: Array<{ id: string; name: string; address?: string | null; created_at?: string }>;
    users: Array<{ id: string; email: string; name?: string | null; role: string; joined_at?: string }>;
    store_count: number;
    user_count: number;
    subscription: {
        status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
        current_period_start: string;
        current_period_end: string;
        cancel_at_period_end: boolean;
        provider_name?: string | null;
        plan: {
            code: PlanCode;
            name: string;
            description?: string | null;
            monthly_price: number;
            yearly_price?: number | null;
        };
    } | null;
};

export default function AdminTenantsPage() {
    const [tenants, setTenants] = useState<TenantRecord[]>([]);
    const [selectedTenantId, setSelectedTenantId] = useState('');
    const [selectedTenant, setSelectedTenant] = useState<TenantRecord | null>(null);
    const [search, setSearch] = useState('');
    const [planCode, setPlanCode] = useState('');
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const loadTenants = async () => {
        setIsLoading(true);
        try {
            const rows = await api.getAdminTenants({
                search: search || undefined,
                planCode: planCode || undefined,
                status: status || undefined,
            });
            setTenants(rows);

            const nextSelectedId = selectedTenantId || rows[0]?.id || '';
            setSelectedTenantId(nextSelectedId);
            if (nextSelectedId) {
                const detail = await api.getAdminTenant(nextSelectedId);
                setSelectedTenant(detail);
            } else {
                setSelectedTenant(null);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load tenants.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadTenants();
    }, [search, planCode, status]);

    const selectTenant = async (tenantId: string) => {
        setSelectedTenantId(tenantId);
        setError('');
        try {
            const detail = await api.getAdminTenant(tenantId);
            setSelectedTenant(detail);
        } catch (err: any) {
            setError(err.message || 'Failed to load tenant detail.');
        }
    };

    const subscriptionForm = useMemo(() => {
        if (!selectedTenant?.subscription) {
            return {
                planCode: 'FREE',
                status: 'ACTIVE',
                cancelAtPeriodEnd: false,
            };
        }

        return {
            planCode: selectedTenant.subscription.plan.code,
            status: selectedTenant.subscription.status,
            cancelAtPeriodEnd: selectedTenant.subscription.cancel_at_period_end,
        };
    }, [selectedTenant]);

    const [draft, setDraft] = useState(subscriptionForm);

    useEffect(() => {
        setDraft(subscriptionForm);
    }, [subscriptionForm]);

    const saveSubscription = async () => {
        if (!selectedTenant) return;

        setIsSaving(true);
        setError('');
        try {
            await api.updateAdminTenantSubscription(selectedTenant.id, {
                planCode: draft.planCode,
                status: draft.status,
                cancelAtPeriodEnd: draft.cancelAtPeriodEnd,
            });
            await selectTenant(selectedTenant.id);
            await loadTenants();
        } catch (err: any) {
            setError(err.message || 'Failed to update tenant subscription.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-7xl mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Tenant Management</h1>
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">
                        Platform-admin oversight for subscription health, owner assignment, and workspace footprint
                    </p>
                </div>

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-6">
                    <section className="rounded-3xl border border-gray-100 bg-white p-5 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <label className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 flex items-center gap-3">
                                <Search className="w-4 h-4 text-gray-400" />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search by tenant or owner"
                                    className="w-full bg-transparent outline-none text-sm"
                                />
                            </label>
                            <select value={planCode} onChange={(event) => setPlanCode(event.target.value)} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none">
                                <option value="">All plans</option>
                                <option value="FREE">Free</option>
                                <option value="BASIC">Basic</option>
                                <option value="STANDARD">Standard</option>
                                <option value="PREMIUM">Premium</option>
                            </select>
                            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none">
                                <option value="">All statuses</option>
                                <option value="ACTIVE">Active</option>
                                <option value="TRIALING">Trialing</option>
                                <option value="PAST_DUE">Past due</option>
                                <option value="CANCELLED">Cancelled</option>
                            </select>
                        </div>

                        <div className="rounded-2xl border border-gray-100 overflow-hidden">
                            {isLoading ? (
                                <div className="p-8 text-sm text-gray-500 flex items-center justify-center">
                                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading tenants...
                                </div>
                            ) : tenants.length === 0 ? (
                                <div className="p-8 text-sm text-gray-500 text-center">No tenants matched these filters.</div>
                            ) : (
                                <div className="divide-y divide-gray-100">
                                    {tenants.map((tenant) => {
                                        const selected = tenant.id === selectedTenantId;
                                        return (
                                            <button
                                                key={tenant.id}
                                                type="button"
                                                onClick={() => void selectTenant(tenant.id)}
                                                className={`w-full text-left px-5 py-4 transition ${selected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
                                            >
                                                <div className="flex items-start justify-between gap-4">
                                                    <div>
                                                        <p className="text-sm font-black text-gray-900">{tenant.name}</p>
                                                        <p className="mt-1 text-xs text-gray-500">{tenant.owner?.email || 'No owner assigned'}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${tenant.subscription?.plan.code === 'PREMIUM' ? 'bg-amber-100 text-amber-700' : tenant.subscription?.plan.code === 'STANDARD' ? 'bg-indigo-100 text-indigo-700' : tenant.subscription?.plan.code === 'BASIC' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                                            {tenant.subscription?.plan.code || 'NONE'}
                                                        </span>
                                                        <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">{tenant.subscription?.status || 'UNASSIGNED'}</p>
                                                    </div>
                                                </div>
                                                <div className="mt-3 flex gap-4 text-xs text-gray-500">
                                                    <span>{tenant.store_count} stores</span>
                                                    <span>{tenant.user_count} users</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="rounded-3xl border border-gray-100 bg-white p-6 space-y-6">
                        {selectedTenant ? (
                            <>
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Selected Tenant</p>
                                        <h2 className="mt-2 text-3xl font-black tracking-tight">{selectedTenant.name}</h2>
                                        <p className="mt-2 text-sm text-gray-500">Created {formatDate(selectedTenant.created_at)}</p>
                                    </div>
                                    <div className="rounded-2xl bg-gray-50 px-4 py-3 text-right">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Owner</p>
                                        <p className="mt-1 text-sm font-black text-gray-900">{selectedTenant.owner?.name || 'Unknown owner'}</p>
                                        <p className="text-xs text-gray-500">{selectedTenant.owner?.email || 'No owner email'}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <InfoCard icon={Building2} label="Stores" value={String(selectedTenant.store_count)} />
                                    <InfoCard icon={Users} label="Users" value={String(selectedTenant.user_count)} />
                                    <InfoCard icon={ShieldCheck} label="Provider" value={selectedTenant.subscription?.provider_name || 'manual'} />
                                </div>

                                <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5 space-y-4">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Subscription Controls</p>
                                        <h3 className="mt-2 text-lg font-black tracking-tight text-blue-900">Adjust plan and status</h3>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <select value={draft.planCode} onChange={(event) => setDraft((current) => ({ ...current, planCode: event.target.value as PlanCode }))} className="rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm font-medium outline-none">
                                            <option value="FREE">Free</option>
                                            <option value="BASIC">Basic</option>
                                            <option value="STANDARD">Standard</option>
                                            <option value="PREMIUM">Premium</option>
                                        </select>
                                        <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as TenantRecord['subscription']['status'] }))} className="rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm font-medium outline-none">
                                            <option value="ACTIVE">Active</option>
                                            <option value="TRIALING">Trialing</option>
                                            <option value="PAST_DUE">Past due</option>
                                            <option value="CANCELLED">Cancelled</option>
                                        </select>
                                        <label className="rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm font-medium flex items-center justify-between gap-3">
                                            <span>Cancel at period end</span>
                                            <input
                                                type="checkbox"
                                                checked={draft.cancelAtPeriodEnd}
                                                onChange={(event) => setDraft((current) => ({ ...current, cancelAtPeriodEnd: event.target.checked }))}
                                                className="h-4 w-4"
                                            />
                                        </label>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={saveSubscription}
                                        disabled={isSaving}
                                        className="inline-flex items-center rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:opacity-60"
                                    >
                                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                        Save Subscription
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="rounded-2xl border border-gray-100 p-4">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Stores</p>
                                        <div className="mt-3 space-y-3">
                                            {selectedTenant.stores.map((store) => (
                                                <div key={store.id} className="rounded-2xl bg-gray-50 px-4 py-3">
                                                    <p className="text-sm font-black text-gray-900">{store.name}</p>
                                                    <p className="mt-1 text-xs text-gray-500">{store.address || 'No address recorded'}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-gray-100 p-4">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Users</p>
                                        <div className="mt-3 space-y-3">
                                            {selectedTenant.users.map((user) => (
                                                <div key={user.id} className="rounded-2xl bg-gray-50 px-4 py-3">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div>
                                                            <p className="text-sm font-black text-gray-900">{user.name || user.email}</p>
                                                            <p className="mt-1 text-xs text-gray-500">{user.email}</p>
                                                        </div>
                                                        <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-gray-500">{user.role}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">
                                Select a tenant to inspect and update subscription settings.
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

function InfoCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
    return (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                    <p className="mt-2 text-lg font-black text-gray-900">{value}</p>
                </div>
                <Icon className="w-5 h-5 text-gray-400" />
            </div>
        </div>
    );
}