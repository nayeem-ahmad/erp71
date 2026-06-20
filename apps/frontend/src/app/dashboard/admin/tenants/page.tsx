'use client';

import { useI18n, formatMessage } from '@/lib/i18n';
import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle, Loader2, LogIn, Plus, Search, ShieldCheck, Users, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

type PlanCode = 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

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
    const { t } = useI18n();
    const m = t.admin.tenants;
    const [tenants, setTenants] = useState<TenantRecord[]>([]);
    const [selectedTenantId, setSelectedTenantId] = useState('');
    const [selectedTenant, setSelectedTenant] = useState<TenantRecord | null>(null);
    const [search, setSearch] = useState('');
    const [planCode, setPlanCode] = useState('');
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isSuspending, setIsSuspending] = useState(false);
    const [isImpersonating, setIsImpersonating] = useState(false);

    const mc = m.createModal;

    type CreateDraft = {
        ownerEmail: string;
        ownerName: string;
        existingEmail: string;
        ownerUserId: string;
        tenantName: string;
        storeName: string;
        address: string;
        businessType: string;
        planCode: PlanCode;
    };

    const emptyDraft = (): CreateDraft => ({
        ownerEmail: '', ownerName: '', existingEmail: '', ownerUserId: '',
        tenantName: '', storeName: '', address: '', businessType: '', planCode: 'FREE',
    });

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createMode, setCreateMode] = useState<'new' | 'existing'>('new');
    const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyDraft());
    const [lookupResult, setLookupResult] = useState<{ id: string; email: string; name: string | null } | null>(null);
    const [lookupNotFound, setLookupNotFound] = useState(false);
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState('');

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
            setError(err.message || m.loadFailed);
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
            setError(err.message || m.loadDetailFailed);
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

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3500);
    };

    const openCreateModal = () => {
        setCreateDraft(emptyDraft());
        setCreateMode('new');
        setLookupResult(null);
        setLookupNotFound(false);
        setCreateError('');
        setShowCreateModal(true);
    };

    const closeCreateModal = () => {
        if (isCreating) return;
        setShowCreateModal(false);
    };

    const handleLookup = async () => {
        if (!createDraft.existingEmail) return;
        setIsLookingUp(true);
        setLookupResult(null);
        setLookupNotFound(false);
        setCreateDraft((d) => ({ ...d, ownerUserId: '' }));
        try {
            const user: any = await api.lookupAdminUser(createDraft.existingEmail);
            setLookupResult(user);
            setCreateDraft((d) => ({ ...d, ownerUserId: user.id }));
        } catch {
            setLookupNotFound(true);
        } finally {
            setIsLookingUp(false);
        }
    };

    const handleCreate = async () => {
        setIsCreating(true);
        setCreateError('');
        try {
            const payload: any = {
                ownerMode: createMode,
                tenantName: createDraft.tenantName,
                storeName: createDraft.storeName,
                planCode: createDraft.planCode,
            };
            if (createDraft.address) payload.address = createDraft.address;
            if (createDraft.businessType) payload.businessType = createDraft.businessType;
            if (createMode === 'new') {
                payload.ownerEmail = createDraft.ownerEmail;
                if (createDraft.ownerName) payload.ownerName = createDraft.ownerName;
            } else {
                payload.ownerUserId = createDraft.ownerUserId;
            }

            const created: any = await api.createAdminTenant(payload);
            setShowCreateModal(false);
            showToast(formatMessage(mc.successToast, { name: createDraft.tenantName }));

            const rows = await api.getAdminTenants({});
            setTenants(rows);
            setSelectedTenantId(created.id);
            const detail = await api.getAdminTenant(created.id);
            setSelectedTenant(detail);
        } catch (err: any) {
            setCreateError(err.message || mc.createFailed);
        } finally {
            setIsCreating(false);
        }
    };

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
            setError(err.message || m.updateSubscriptionFailed);
        } finally {
            setIsSaving(false);
        }
    };

    const suspendTenant = async () => {
        if (!selectedTenant) return;
        if (!window.confirm(formatMessage(m.suspendConfirm, { name: selectedTenant.name }))) return;

        setIsSuspending(true);
        setError('');
        try {
            await api.suspendTenant(selectedTenant.id, 'Suspended by platform admin');
            await selectTenant(selectedTenant.id);
            await loadTenants();
            showToast(formatMessage(m.suspendedToast, { name: selectedTenant.name }));
        } catch (err: any) {
            setError(err.message || m.suspendFailed);
        } finally {
            setIsSuspending(false);
        }
    };

    const impersonate = async () => {
        if (!selectedTenant) return;

        setIsImpersonating(true);
        setError('');
        try {
            const res: any = await api.impersonateTenant(selectedTenant.id);
            localStorage.setItem('access_token', res.access_token);
            const firstTenantId = selectedTenant.id;
            localStorage.setItem('tenant_id', firstTenantId);
            showToast(formatMessage(m.impersonateToast, { email: res.impersonated_user.email }));
            setTimeout(() => { window.location.href = '/dashboard'; }, 1500);
        } catch (err: any) {
            setError(err.message || m.impersonateFailed);
        } finally {
            setIsImpersonating(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">{m.title}</h1>
                        <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">
                            {m.subtitle}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={openCreateModal}
                        className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-200 hover:bg-blue-700 shrink-0"
                    >
                        <Plus className="w-4 h-4" /> {mc.trigger}
                    </button>
                </div>

                {toast && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                        <CheckCircle className="w-4 h-4 shrink-0" /> {toast}
                    </div>
                )}

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
                                    placeholder={m.searchPlaceholder}
                                    className="w-full bg-transparent outline-none text-sm"
                                />
                            </label>
                            <select value={planCode} onChange={(event) => setPlanCode(event.target.value)} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none">
                                <option value="">{m.allPlans}</option>
                                <option value="FREE">{m.plans.free}</option>
                                <option value="BASIC">{m.plans.basic}</option>
                                <option value="ACCOUNTING">{m.plans.accounting}</option>
                                <option value="STANDARD">{m.plans.standard}</option>
                                <option value="PREMIUM">{m.plans.premium}</option>
                            </select>
                            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none">
                                <option value="">{m.allStatuses}</option>
                                <option value="ACTIVE">{m.statuses.active}</option>
                                <option value="TRIALING">{m.statuses.trialing}</option>
                                <option value="PAST_DUE">{m.statuses.pastDue}</option>
                                <option value="CANCELLED">{m.statuses.cancelled}</option>
                            </select>
                        </div>

                        <div className="rounded-2xl border border-gray-100 overflow-hidden">
                            {isLoading ? (
                                <div className="p-8 text-sm text-gray-500 flex items-center justify-center">
                                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> {m.loading}
                                </div>
                            ) : tenants.length === 0 ? (
                                <div className="p-8 text-sm text-gray-500 text-center">{m.noResults}</div>
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
                                                        <p className="mt-1 text-xs text-gray-500">{tenant.owner?.email || m.noOwner}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${tenant.subscription?.plan.code === 'PREMIUM' ? 'bg-amber-100 text-amber-700' : tenant.subscription?.plan.code === 'STANDARD' ? 'bg-indigo-100 text-indigo-700' : tenant.subscription?.plan.code === 'BASIC' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                                            {tenant.subscription?.plan.code || 'NONE'}
                                                        </span>
                                                        <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">{tenant.subscription?.status || m.unassigned}</p>
                                                    </div>
                                                </div>
                                                <div className="mt-3 flex gap-4 text-xs text-gray-500">
                                                    <span>{formatMessage(m.storesCount, { count: tenant.store_count })}</span>
                                                    <span>{formatMessage(m.usersCount, { count: tenant.user_count })}</span>
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
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{m.selectedTenant}</p>
                                        <h2 className="mt-2 text-3xl font-black tracking-tight">{selectedTenant.name}</h2>
                                        <p className="mt-2 text-sm text-gray-500">{formatMessage(m.created, { date: formatDate(selectedTenant.created_at) })}</p>
                                    </div>
                                    <div className="rounded-2xl bg-gray-50 px-4 py-3 text-right">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{m.owner}</p>
                                        <p className="mt-1 text-sm font-black text-gray-900">{selectedTenant.owner?.name || m.unknownOwner}</p>
                                        <p className="text-xs text-gray-500">{selectedTenant.owner?.email || m.noOwnerEmail}</p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-3">
                                    <button
                                        type="button"
                                        onClick={impersonate}
                                        disabled={isImpersonating}
                                        className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:opacity-60"
                                    >
                                        {isImpersonating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                                        {m.impersonateOwner}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={suspendTenant}
                                        disabled={isSuspending || selectedTenant.subscription?.status === 'CANCELLED'}
                                        className="inline-flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-2.5 text-sm font-black text-red-600 transition hover:bg-red-100 disabled:opacity-60"
                                    >
                                        {isSuspending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                                        {selectedTenant.subscription?.status === 'CANCELLED' ? m.alreadySuspended : m.suspendTenant}
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <InfoCard icon={Building2} label={m.infoCards.stores} value={String(selectedTenant.store_count)} />
                                    <InfoCard icon={Users} label={m.infoCards.users} value={String(selectedTenant.user_count)} />
                                    <InfoCard icon={ShieldCheck} label={m.infoCards.provider} value={selectedTenant.subscription?.provider_name || 'manual'} />
                                </div>

                                <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5 space-y-4">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">{m.subscriptionControls.badge}</p>
                                        <h3 className="mt-2 text-lg font-black tracking-tight text-blue-900">{m.subscriptionControls.title}</h3>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <select value={draft.planCode} onChange={(event) => setDraft((current) => ({ ...current, planCode: event.target.value as PlanCode }))} className="rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm font-medium outline-none">
                                            <option value="FREE">Free</option>
                                            <option value="BASIC">Basic</option>
                                            <option value="ACCOUNTING">Accounting</option>
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
                                            <span>{m.subscriptionControls.cancelAtPeriodEnd}</span>
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
                                        {m.subscriptionControls.save}
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="rounded-2xl border border-gray-100 p-4">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{m.storesSection}</p>
                                        <div className="mt-3 space-y-3">
                                            {selectedTenant.stores.map((store) => (
                                                <div key={store.id} className="rounded-2xl bg-gray-50 px-4 py-3">
                                                    <p className="text-sm font-black text-gray-900">{store.name}</p>
                                                    <p className="mt-1 text-xs text-gray-500">{store.address || m.noAddress}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-gray-100 p-4">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{m.usersSection}</p>
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
                                {m.selectPrompt}
                            </div>
                        )}
                    </section>
                </div>
            </div>

            {showCreateModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={closeCreateModal}
                >
                    <div
                        className="w-full max-w-lg rounded-3xl bg-white shadow-2xl flex flex-col max-h-[90vh]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="border-b border-gray-100 px-6 py-5 shrink-0">
                            <h2 className="text-lg font-black tracking-tight">{mc.title}</h2>
                        </div>

                        {/* Body */}
                        <div className="p-6 space-y-5 overflow-y-auto">
                            {createError && (
                                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                                    {createError}
                                </div>
                            )}

                            {/* Owner */}
                            <div className="space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{mc.ownerSection}</p>
                                <div className="flex rounded-2xl border border-gray-100 overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => { setCreateMode('new'); setLookupResult(null); setLookupNotFound(false); }}
                                        className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest transition ${createMode === 'new' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                                    >
                                        {mc.tabNewUser}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCreateMode('existing')}
                                        className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest transition ${createMode === 'existing' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                                    >
                                        {mc.tabExistingUser}
                                    </button>
                                </div>

                                {createMode === 'new' ? (
                                    <div className="space-y-3">
                                        <input
                                            type="email"
                                            value={createDraft.ownerEmail}
                                            onChange={(e) => setCreateDraft((d) => ({ ...d, ownerEmail: e.target.value }))}
                                            placeholder={mc.ownerEmail}
                                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                                        />
                                        <input
                                            value={createDraft.ownerName}
                                            onChange={(e) => setCreateDraft((d) => ({ ...d, ownerName: e.target.value }))}
                                            placeholder={mc.ownerName}
                                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                                        />
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                value={createDraft.existingEmail}
                                                onChange={(e) => setCreateDraft((d) => ({ ...d, existingEmail: e.target.value }))}
                                                placeholder={mc.lookupEmail}
                                                className="flex-1 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => void handleLookup()}
                                                disabled={isLookingUp || !createDraft.existingEmail}
                                                className="rounded-2xl bg-gray-800 px-4 py-3 text-xs font-black text-white hover:bg-gray-700 disabled:opacity-50"
                                            >
                                                {isLookingUp ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                                            </button>
                                        </div>
                                        {lookupResult && (
                                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                                                {lookupResult.name || lookupResult.email}
                                            </div>
                                        )}
                                        {lookupNotFound && (
                                            <p className="text-xs font-semibold text-red-500">{mc.userNotFound}</p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Tenant & Store */}
                            <div className="space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{mc.tenantSection}</p>
                                <input
                                    value={createDraft.tenantName}
                                    onChange={(e) => setCreateDraft((d) => ({ ...d, tenantName: e.target.value }))}
                                    placeholder={mc.tenantName}
                                    className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                                />
                                <input
                                    value={createDraft.storeName}
                                    onChange={(e) => setCreateDraft((d) => ({ ...d, storeName: e.target.value }))}
                                    placeholder={mc.storeName}
                                    className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                                />
                                <input
                                    value={createDraft.address}
                                    onChange={(e) => setCreateDraft((d) => ({ ...d, address: e.target.value }))}
                                    placeholder={mc.address}
                                    className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                                />
                                <select
                                    value={createDraft.businessType}
                                    onChange={(e) => setCreateDraft((d) => ({ ...d, businessType: e.target.value }))}
                                    className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none"
                                >
                                    <option value="">{mc.businessType}</option>
                                    <option value="GROCERY">Grocery</option>
                                    <option value="PHARMACY">Pharmacy</option>
                                    <option value="SURGICAL_MEDICAL">Surgical / Medical</option>
                                    <option value="COMPUTER_HARDWARE">Computer Hardware</option>
                                </select>
                            </div>

                            {/* Plan */}
                            <div className="space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{mc.plan}</p>
                                <select
                                    value={createDraft.planCode}
                                    onChange={(e) => setCreateDraft((d) => ({ ...d, planCode: e.target.value as PlanCode }))}
                                    className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none"
                                >
                                    <option value="FREE">Free</option>
                                    <option value="BASIC">Basic</option>
                                    <option value="ACCOUNTING">Accounting</option>
                                    <option value="STANDARD">Standard</option>
                                    <option value="PREMIUM">Premium</option>
                                </select>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4 shrink-0">
                            <button
                                type="button"
                                onClick={closeCreateModal}
                                disabled={isCreating}
                                className="rounded-2xl bg-gray-100 px-5 py-2.5 text-sm font-black text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                            >
                                {mc.cancel}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleCreate()}
                                disabled={isCreating}
                                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-60"
                            >
                                {isCreating
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> {mc.creating}</>
                                    : mc.create}
                            </button>
                        </div>
                    </div>
                </div>
            )}
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