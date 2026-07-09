'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, LogIn, RotateCcw, ShieldCheck, Trash2, UserX, Users, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import type { DiscountType, PlanCode, SecondaryLocale, TenantRecord } from './types';

type Props = {
    tenantId: string | null;
    onClose: () => void;
    onChanged: () => void;
    onToast: (message: string) => void;
};

function InfoCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
    return (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-medium text-gray-500">{label}</p>
                    <p className="mt-2 text-lg font-black text-gray-900">{value}</p>
                </div>
                <Icon className="w-5 h-5 text-gray-400" />
            </div>
        </div>
    );
}

export default function TenantDetailModal({ tenantId, onClose, onChanged, onToast }: Props) {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const sc = m.subscriptionControls;
    const lc = m.localizationControls;
    const nc = m.navLayoutControls;

    const [tenant, setTenant] = useState<TenantRecord | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingLocalization, setIsSavingLocalization] = useState(false);
    const [isSuspending, setIsSuspending] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isImpersonating, setIsImpersonating] = useState(false);
    const [tenantNavKind, setTenantNavKind] = useState<'none' | 'custom' | 'pinned_default'>('none');
    const [isResettingTenantNav, setIsResettingTenantNav] = useState(false);

    const subscriptionForm = useMemo(() => {
        if (!tenant?.subscription) {
            return {
                planCode: 'FREE' as PlanCode,
                status: 'ACTIVE' as const,
                cancelAtPeriodEnd: false,
                discountMode: 'NONE' as 'NONE' | DiscountType,
                discountValue: '',
            };
        }
        return {
            planCode: tenant.subscription.plan.code,
            status: tenant.subscription.status,
            cancelAtPeriodEnd: tenant.subscription.cancel_at_period_end,
            discountMode: (tenant.subscription.discount_type ?? 'NONE') as 'NONE' | DiscountType,
            discountValue: tenant.subscription.discount_value != null ? String(tenant.subscription.discount_value) : '',
        };
    }, [tenant]);

    const [draft, setDraft] = useState(subscriptionForm);

    const localizationForm = useMemo(() => ({
        localization_enabled: Boolean(tenant?.localization_enabled),
        secondary_locale: (tenant?.secondary_locale || '') as SecondaryLocale | '',
    }), [tenant]);

    const [localizationDraft, setLocalizationDraft] = useState(localizationForm);

    useEffect(() => {
        setDraft(subscriptionForm);
    }, [subscriptionForm]);

    useEffect(() => {
        setLocalizationDraft(localizationForm);
    }, [localizationForm]);

    const loadTenant = async (id: string) => {
        setLoading(true);
        setError('');
        try {
            const [detail, navOverride] = await Promise.all([
                api.getAdminTenant(id),
                api.getAdminTenantNavOverride(id).catch(() => null),
            ]);
            setTenant(detail);
            setTenantNavKind(navOverride?.kind ?? 'none');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadDetailFailed);
            setTenant(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!tenantId) {
            setTenant(null);
            return;
        }
        void loadTenant(tenantId);
    }, [tenantId]);

    if (!tenantId) return null;

    const saveSubscription = async () => {
        if (!tenant) return;
        let discountType: DiscountType | null = null;
        let discountValue: number | null = null;
        if (draft.discountMode !== 'NONE') {
            const value = Number(draft.discountValue);
            if (!Number.isFinite(value) || value <= 0) {
                setError(sc.discountInvalid);
                return;
            }
            if (draft.discountMode === 'PERCENTAGE' && value > 100) {
                setError(sc.discountPercentInvalid);
                return;
            }
            discountType = draft.discountMode;
            discountValue = value;
        }
        setIsSaving(true);
        setError('');
        try {
            await api.updateAdminTenantSubscription(tenant.id, {
                planCode: draft.planCode,
                status: draft.status,
                cancelAtPeriodEnd: draft.cancelAtPeriodEnd,
                discountType,
                discountValue,
            });
            await loadTenant(tenant.id);
            onChanged();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.updateSubscriptionFailed);
        } finally {
            setIsSaving(false);
        }
    };

    const saveLocalization = async () => {
        if (!tenant) return;
        if (localizationDraft.localization_enabled && !localizationDraft.secondary_locale) {
            setError(lc.secondaryRequired);
            return;
        }
        setIsSavingLocalization(true);
        setError('');
        try {
            await api.updateAdminTenantLocalization(tenant.id, {
                localization_enabled: localizationDraft.localization_enabled,
                secondary_locale: localizationDraft.localization_enabled
                    ? (localizationDraft.secondary_locale as SecondaryLocale)
                    : null,
            });
            await loadTenant(tenant.id);
            onToast(lc.saved);
            onChanged();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : lc.saveFailed);
        } finally {
            setIsSavingLocalization(false);
        }
    };

    const resetTenantNavLayout = async () => {
        if (!tenant) return;
        if (!window.confirm(formatMessage(nc.resetConfirm, { name: tenant.name }))) return;
        setIsResettingTenantNav(true);
        try {
            await api.resetAdminTenantNavLayout(tenant.id);
            setTenantNavKind('pinned_default');
            onToast(formatMessage(nc.resetSuccess, { name: tenant.name }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : nc.resetFailed);
        } finally {
            setIsResettingTenantNav(false);
        }
    };

    const suspendTenant = async () => {
        if (!tenant) return;
        if (!window.confirm(formatMessage(m.suspendConfirm, { name: tenant.name }))) return;
        setIsSuspending(true);
        setError('');
        try {
            await api.suspendTenant(tenant.id, 'Suspended by platform admin');
            await loadTenant(tenant.id);
            onChanged();
            onToast(formatMessage(m.suspendedToast, { name: tenant.name }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.suspendFailed);
        } finally {
            setIsSuspending(false);
        }
    };

    const deleteTenant = async () => {
        if (!tenant) return;
        if (!window.confirm(formatMessage(m.deleteConfirm, { name: tenant.name }))) return;
        setIsDeleting(true);
        setError('');
        try {
            await api.deleteAdminTenant(tenant.id, 'Deleted by platform admin');
            onToast(formatMessage(m.deletedToast, { name: tenant.name }));
            onChanged();
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.deleteFailed);
        } finally {
            setIsDeleting(false);
        }
    };

    const impersonate = async () => {
        if (!tenant) return;
        setIsImpersonating(true);
        setError('');
        try {
            const res: { access_token: string; impersonated_user: { email: string } } = await api.impersonateTenant(tenant.id);
            localStorage.setItem('access_token', res.access_token);
            localStorage.setItem('tenant_id', tenant.id);
            onToast(formatMessage(m.impersonateToast, { email: res.impersonated_user.email }));
            setTimeout(() => { window.location.href = '/dashboard'; }, 1500);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.impersonateFailed);
        } finally {
            setIsImpersonating(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl flex flex-col max-h-[92vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5 shrink-0">
                    <div>
                        <p className="text-xs font-medium text-gray-500">{m.selectedTenant}</p>
                        <h2 className="mt-1 text-lg font-bold tracking-tight text-gray-950">
                            {tenant?.name ?? '…'}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto p-6 space-y-6">
                    {error && (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                        </div>
                    ) : tenant ? (
                        <>
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <p className="text-sm text-gray-500">{formatMessage(m.created, { date: formatDate(tenant.created_at) })}</p>
                                <div className="rounded-2xl bg-gray-50 px-4 py-3 text-right">
                                    <p className="text-xs font-medium text-gray-500">{m.owner}</p>
                                    <p className="mt-1 text-sm font-black text-gray-900">{tenant.owner?.name || m.unknownOwner}</p>
                                    <p className="text-xs text-gray-500">{tenant.owner?.email || m.noOwnerEmail}</p>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={() => void impersonate()}
                                    disabled={isImpersonating}
                                    className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:opacity-60"
                                >
                                    {isImpersonating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                                    {m.impersonateOwner}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void suspendTenant()}
                                    disabled={isSuspending || tenant.subscription?.status === 'CANCELLED'}
                                    className="inline-flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-2.5 text-sm font-black text-red-600 transition hover:bg-red-100 disabled:opacity-60"
                                >
                                    {isSuspending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                                    {tenant.subscription?.status === 'CANCELLED' ? m.alreadySuspended : m.suspendTenant}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void deleteTenant()}
                                    disabled={isDeleting}
                                    className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-700 disabled:opacity-60"
                                >
                                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    {m.deleteTenant}
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <InfoCard icon={Building2} label={m.infoCards.stores} value={String(tenant.store_count)} />
                                <InfoCard icon={Users} label={m.infoCards.users} value={String(tenant.user_count)} />
                                <InfoCard icon={ShieldCheck} label={m.infoCards.provider} value={tenant.subscription?.provider_name || 'manual'} />
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
                                <div>
                                    <p className="text-xs font-medium text-blue-700/80 mb-1.5">{sc.discountLabel}</p>
                                    <div className="flex gap-3">
                                        <select
                                            value={draft.discountMode}
                                            onChange={(event) => setDraft((current) => ({ ...current, discountMode: event.target.value as 'NONE' | DiscountType }))}
                                            className="rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm font-medium outline-none"
                                        >
                                            <option value="NONE">{sc.discountNone}</option>
                                            <option value="PERCENTAGE">{sc.discountPercent}</option>
                                            <option value="FIXED">{sc.discountFixed}</option>
                                        </select>
                                        {draft.discountMode !== 'NONE' && (
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={draft.discountValue}
                                                onChange={(event) => setDraft((current) => ({ ...current, discountValue: event.target.value }))}
                                                placeholder={draft.discountMode === 'PERCENTAGE' ? '%' : '৳'}
                                                className="flex-1 rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm outline-none"
                                            />
                                        )}
                                    </div>
                                    <p className="mt-1.5 text-xs text-blue-700/70">{sc.discountHint}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void saveSubscription()}
                                    disabled={isSaving}
                                    className="inline-flex items-center rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:opacity-60"
                                >
                                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                    {m.subscriptionControls.save}
                                </button>
                            </div>

                            <div className="rounded-3xl border border-violet-100 bg-violet-50/70 p-5 space-y-4">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-violet-400">{lc.badge}</p>
                                    <h3 className="mt-2 text-lg font-black tracking-tight text-violet-900">{lc.title}</h3>
                                    <p className="mt-1 text-xs text-violet-700/80">{lc.description}</p>
                                </div>
                                <label className="rounded-2xl border border-violet-100 bg-white px-4 py-3 text-sm font-medium flex items-center justify-between gap-3">
                                    <span>{lc.enabledLabel}</span>
                                    <input
                                        type="checkbox"
                                        checked={localizationDraft.localization_enabled}
                                        onChange={(event) => setLocalizationDraft((current) => ({
                                            ...current,
                                            localization_enabled: event.target.checked,
                                            secondary_locale: event.target.checked ? current.secondary_locale : '',
                                        }))}
                                        className="h-4 w-4"
                                    />
                                </label>
                                {localizationDraft.localization_enabled ? (
                                    <select
                                        value={localizationDraft.secondary_locale}
                                        onChange={(event) => setLocalizationDraft((current) => ({
                                            ...current,
                                            secondary_locale: event.target.value as SecondaryLocale | '',
                                        }))}
                                        className="w-full rounded-2xl border border-violet-100 bg-white px-4 py-3 text-sm font-medium outline-none"
                                    >
                                        <option value="">{lc.secondaryPlaceholder}</option>
                                        <option value="bn">বাংলা (Bangla)</option>
                                        <option value="ms">Bahasa Melayu (Malay)</option>
                                    </select>
                                ) : (
                                    <p className="text-xs font-medium text-violet-700">{lc.englishOnly}</p>
                                )}
                                <button
                                    type="button"
                                    onClick={() => void saveLocalization()}
                                    disabled={isSavingLocalization}
                                    className="inline-flex items-center rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:opacity-60"
                                >
                                    {isSavingLocalization ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                    {lc.save}
                                </button>
                            </div>

                            <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5 space-y-4">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{nc.badge}</p>
                                    <h3 className="mt-2 text-lg font-black tracking-tight text-slate-900">{nc.title}</h3>
                                    <p className="mt-1 text-xs text-slate-600">{nc.description}</p>
                                </div>
                                <p className="text-sm text-slate-700">
                                    {tenantNavKind === 'custom'
                                        ? nc.status.custom
                                        : tenantNavKind === 'pinned_default'
                                            ? nc.status.pinned
                                            : nc.status.inherit}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => void resetTenantNavLayout()}
                                    disabled={isResettingTenantNav}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                                >
                                    {isResettingTenantNav ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                    {nc.reset}
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="rounded-2xl border border-gray-100 p-4">
                                    <p className="text-xs font-medium text-gray-500">{m.storesSection}</p>
                                    <div className="mt-3 space-y-3">
                                        {tenant.stores.map((store) => (
                                            <div key={store.id} className="rounded-2xl bg-gray-50 px-4 py-3">
                                                <p className="text-sm font-black text-gray-900">{store.name}</p>
                                                <p className="mt-1 text-xs text-gray-500">{store.address || m.noAddress}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-gray-100 p-4 md:col-span-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.admin.users.tenantUsers.title}</p>
                                    <h3 className="mt-2 text-sm font-black text-gray-900">{m.usersSection}</h3>
                                    <p className="mt-1 text-xs text-gray-500">{t.admin.users.tenantUsers.description}</p>
                                    <div className="mt-4 overflow-hidden rounded-2xl border border-gray-100">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="bg-gray-50 text-left">
                                                    <th className="px-4 py-2.5 font-black uppercase tracking-widest text-[10px] text-gray-500">{t.admin.users.tenantUsers.columns.name}</th>
                                                    <th className="px-4 py-2.5 font-black uppercase tracking-widest text-[10px] text-gray-500">{t.admin.users.tenantUsers.columns.email}</th>
                                                    <th className="px-4 py-2.5 font-black uppercase tracking-widest text-[10px] text-gray-500">{t.admin.users.tenantUsers.columns.role}</th>
                                                    <th className="px-4 py-2.5 font-black uppercase tracking-widest text-[10px] text-gray-500">{t.admin.users.tenantUsers.columns.joined}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {tenant.users.map((user) => (
                                                    <tr key={user.id}>
                                                        <td className="px-4 py-3 font-semibold text-gray-900">{user.name || user.email}</td>
                                                        <td className="px-4 py-3 text-gray-600">{user.email}</td>
                                                        <td className="px-4 py-3">
                                                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-gray-600">{user.role}</span>
                                                        </td>
                                                        <td className="px-4 py-3 text-gray-500">{user.joined_at ? formatDate(user.joined_at) : '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}