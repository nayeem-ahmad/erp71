'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, BadgeCheck, CreditCard, Loader2, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { redirectTo } from '@/lib/browser';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

type PlanCode = 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

type BillingSummary = {
    tenant: { id: string; name: string };
    role: string;
    can_manage_billing: boolean;
    provider_name?: 'manual' | 'ssl-wireless';
    subscription: {
        status: string;
        current_period_start: string;
        current_period_end: string;
        cancel_at_period_end: boolean;
        provider_name?: string | null;
        plan?: {
            code: PlanCode;
            name: string;
            description?: string | null;
            monthly_price: number;
            yearly_price?: number | null;
        } | null;
    } | null;
    available_plans: Array<{
        code: PlanCode;
        name: string;
        description?: string | null;
        monthly_price: number;
        yearly_price?: number | null;
    }>;
    billing_history?: Array<{
        id: string;
        event_type: string;
        status: string;
        amount?: number | null;
        currency?: string | null;
        reference_id?: string | null;
        created_at: string;
    }>;
};

type AddonCatalogItem = {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    category?: string | null;
    monthly_price: number;
    yearly_price?: number | null;
};

type MyAddonSubscription = {
    addon: AddonCatalogItem;
    status: string;
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
};

export default function BillingPage() {
    return (
        <Suspense fallback={<BillingPageFallback />}>
            <BillingPageContent />
        </Suspense>
    );
}

function BillingPageContent() {
    const { t, locale } = useI18n();
    const copy = t.billing;
    const router = useRouter();
    const searchParams = useSearchParams();
    const [summary, setSummary] = useState<BillingSummary | null>(null);
    const [selectedPlanCode, setSelectedPlanCode] = useState<PlanCode>('FREE');
    const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
    const [checkout, setCheckout] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [addonCatalog, setAddonCatalog] = useState<AddonCatalogItem[]>([]);
    const [myAddons, setMyAddons] = useState<MyAddonSubscription[]>([]);
    const [selectedAddonCodes, setSelectedAddonCodes] = useState<string[]>([]);

    const loadSummary = async () => {
        setIsLoading(true);
        try {
            const nextSummary = await api.getBillingSummary();
            setSummary(nextSummary);
            if (nextSummary.subscription?.plan?.code) {
                localStorage.setItem('subscription_plan_code', nextSummary.subscription.plan.code);
            }

            const queryPlan = searchParams.get('plan');
            const queryCycle = searchParams.get('cycle');
            const fallbackPlan = nextSummary.subscription?.plan?.code ?? nextSummary.available_plans[0]?.code ?? 'FREE';

            setSelectedPlanCode((queryPlan as PlanCode) || fallbackPlan);
            setBillingCycle(queryCycle === 'yearly' ? 'YEARLY' : 'MONTHLY');
        } catch (err: any) {
            setError(err.message || copy.loadFailed);
        } finally {
            setIsLoading(false);
        }
    };

    const loadAddons = async () => {
        try {
            const [catalog, mine] = await Promise.all([
                api.getAddonCatalog(),
                api.getMyAddonSubscriptions(),
            ]);
            setAddonCatalog(catalog ?? []);
            setMyAddons(mine ?? []);
        } catch {
            // Non-fatal — the base plan summary above still loaded fine.
        }
    };

    useEffect(() => {
        void loadSummary();
        void loadAddons();
    }, []);

    useEffect(() => {
        const paymentStatus = searchParams.get('paymentStatus');
        const paymentMessage = searchParams.get('message');

        if (paymentStatus === 'success') {
            setNotice(paymentMessage || copy.paymentSuccess);
            setError('');
        } else if (paymentStatus === 'failed' || paymentStatus === 'cancel') {
            setError(paymentMessage || copy.paymentFailed);
            setNotice('');
        }
    }, [searchParams, copy.paymentSuccess, copy.paymentFailed]);

    const selectedPlan = useMemo(
        () => summary?.available_plans.find((plan) => plan.code === selectedPlanCode) ?? null,
        [selectedPlanCode, summary],
    );

    const myAddonCodes = useMemo(() => new Set(myAddons.map((row) => row.addon.code)), [myAddons]);
    const availableAddons = useMemo(
        () => addonCatalog.filter((addon) => !myAddonCodes.has(addon.code)),
        [addonCatalog, myAddonCodes],
    );
    const addonsTotal = useMemo(() => {
        return availableAddons
            .filter((addon) => selectedAddonCodes.includes(addon.code))
            .reduce((sum, addon) => {
                const price = billingCycle === 'YEARLY' ? (addon.yearly_price ?? addon.monthly_price * 12) : addon.monthly_price;
                return sum + price;
            }, 0);
    }, [availableAddons, selectedAddonCodes, billingCycle]);

    const toggleAddon = (code: string) => {
        setSelectedAddonCodes((current) => (
            current.includes(code) ? current.filter((c) => c !== code) : [...current, code]
        ));
    };

    const activeReference = checkout?.reference || searchParams.get('reference');
    const isSslProvider = summary?.provider_name === 'ssl-wireless';
    const tenantLabel = summary?.tenant.name || copy.yourTenant;

    const startCheckout = async () => {
        setIsSubmitting(true);
        setError('');
        setNotice('');
        try {
            const session = await api.createBillingCheckoutSession({
                planCode: selectedPlanCode,
                billingCycle,
                addonCodes: selectedAddonCodes,
            });
            setCheckout(session);
            if (session.requires_confirmation === false && session.checkout_url) {
                redirectTo(session.checkout_url);
                return;
            }
            router.replace(`/billing?reference=${encodeURIComponent(session.reference)}&plan=${session.plan.code}&cycle=${session.billing_cycle.toLowerCase()}`);
        } catch (err: any) {
            setError(err.message || copy.checkoutStartFailed);
        } finally {
            setIsSubmitting(false);
        }
    };

    const confirmCheckout = async () => {
        setIsSubmitting(true);
        setError('');
        try {
            await api.confirmBillingCheckout({
                planCode: selectedPlanCode,
                billingCycle,
                reference: activeReference,
                addonCodes: selectedAddonCodes,
            });
            localStorage.setItem('subscription_plan_code', selectedPlanCode);
            setCheckout(null);
            setSelectedAddonCodes([]);
            router.replace('/billing');
            await loadSummary();
            await loadAddons();
        } catch (err: any) {
            setError(err.message || copy.checkoutConfirmFailed);
        } finally {
            setIsSubmitting(false);
        }
    };

    const cancelAtPeriodEnd = async () => {
        setIsSubmitting(true);
        setError('');
        try {
            await api.cancelBillingAtPeriodEnd();
            await loadSummary();
        } catch (err: any) {
            setError(err.message || copy.cancellationFailed);
        } finally {
            setIsSubmitting(false);
        }
    };

    const cancelAddon = async (code: string) => {
        setIsSubmitting(true);
        setError('');
        try {
            await api.cancelAddonAtPeriodEnd(code);
            await loadAddons();
        } catch (err: any) {
            setError(err.message || 'Failed to cancel add-on.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-6xl mx-auto space-y-6">
                <PageHeader
                    title={copy.title}
                    subtitle={formatMessage(copy.subtitle, { tenant: tenantLabel })}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.billing,
                        copy.title,
                        'billing',
                    )}
                />

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}

                {notice && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                        {notice}
                    </div>
                )}

                {isLoading ? (
                    <div className="rounded-3xl border border-gray-100 bg-white p-8 flex items-center justify-center text-gray-500">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" /> {copy.loadingSummary}
                    </div>
                ) : summary && (
                    <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
                        <section className="rounded-3xl border border-gray-100 bg-white p-6 space-y-6">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-medium text-gray-500">{copy.currentSubscription}</p>
                                    <div className="mt-2 flex items-center gap-3">
                                        <h2 className="text-lg font-bold tracking-tight text-gray-950">{summary.subscription?.plan?.name || copy.noActivePlan}</h2>
                                        {summary.subscription?.plan?.code && (
                                            <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${summary.subscription.plan.code === 'PREMIUM' ? 'bg-amber-100 text-amber-700' : summary.subscription.plan.code === 'STANDARD' ? 'bg-indigo-100 text-indigo-700' : summary.subscription.plan.code === 'BASIC' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                                {summary.subscription.plan.code}
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-2 text-sm text-gray-500 max-w-2xl">
                                        {summary.subscription?.plan?.description || copy.planDetailsUnavailable}
                                    </p>
                                </div>
                                <div className="rounded-2xl bg-gray-50 px-4 py-3 min-w-[220px]">
                                    <p className="text-xs font-medium text-gray-500">{copy.status}</p>
                                    <p className="mt-1 text-lg font-black text-gray-900">{summary.subscription?.status || copy.unassigned}</p>
                                    <p className="mt-1 text-xs text-gray-500">
                                        {summary.subscription
                                            ? formatMessage(copy.periodEnds, {
                                                date: formatDate(summary.subscription.current_period_end, locale),
                                            })
                                            : copy.createSubscription}
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <MetricCard label={copy.role} value={summary.role} />
                                <MetricCard label={copy.provider} value={summary.subscription?.provider_name || 'manual'} />
                                <MetricCard
                                    label={copy.cancellation}
                                    value={summary.subscription?.cancel_at_period_end ? copy.scheduled : copy.active}
                                />
                            </div>

                            {myAddons.length > 0 && (
                                <div className="rounded-3xl border border-gray-100 bg-gray-50 p-5 space-y-3">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-500">
                                        Your Add-ons
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {myAddons.map((row) => (
                                            <div key={row.addon.code} className="rounded-2xl border border-gray-200 bg-white p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-black text-gray-900">{row.addon.name}</p>
                                                        <p className="mt-1 text-xs text-gray-500">
                                                            {formatMessage(copy.periodEnds, {
                                                                date: formatDate(row.current_period_end, locale),
                                                            })}
                                                        </p>
                                                    </div>
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                                        {row.cancel_at_period_end ? copy.scheduled : row.status}
                                                    </span>
                                                </div>
                                                {summary.can_manage_billing && !row.cancel_at_period_end && (
                                                    <button
                                                        type="button"
                                                        onClick={() => cancelAddon(row.addon.code)}
                                                        disabled={isSubmitting}
                                                        className="mt-3 inline-flex items-center rounded-xl bg-white px-3 py-2 text-xs font-bold text-rose-700 border border-rose-200 transition hover:bg-rose-50 disabled:opacity-60"
                                                    >
                                                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                                                        {copy.cancelAtPeriodEnd}
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {summary.can_manage_billing ? (
                                <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5 space-y-4">
                                    <div className="flex items-center gap-2 text-blue-700">
                                        <BadgeCheck className="w-5 h-5" />
                                        <h3 className="text-lg font-black tracking-tight">{isSslProvider ? copy.sslCheckout : copy.sandboxCheckout}</h3>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {summary.available_plans.map((plan) => {
                                            const selected = selectedPlanCode === plan.code;
                                            const displayedPrice = billingCycle === 'YEARLY'
                                                ? plan.yearly_price ?? plan.monthly_price * 12
                                                : plan.monthly_price;

                                            return (
                                                <button
                                                    key={plan.code}
                                                    type="button"
                                                    onClick={() => setSelectedPlanCode(plan.code)}
                                                    className={`rounded-2xl border p-4 text-left transition-all ${selected ? 'border-blue-600 bg-white shadow-lg shadow-blue-100' : 'border-blue-100 bg-white/70 hover:border-blue-200'}`}
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-lg font-black text-gray-900">{plan.name}</span>
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{plan.code}</span>
                                                    </div>
                                                    <p className="mt-2 text-sm text-gray-500">{plan.description}</p>
                                                    <p className="mt-3 text-xl font-black text-gray-900">{formatBDT(displayedPrice, { locale })}</p>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {availableAddons.length > 0 && (
                                        <div className="space-y-3 border-t border-blue-100 pt-4">
                                            <h4 className="text-sm font-black uppercase tracking-widest text-blue-900">
                                                Available Add-ons
                                            </h4>
                                            <p className="text-xs text-blue-800/70">
                                                Optional modules billed alongside your plan in the same checkout.
                                            </p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {availableAddons.map((addon) => {
                                                    const checked = selectedAddonCodes.includes(addon.code);
                                                    const addonPrice = billingCycle === 'YEARLY'
                                                        ? (addon.yearly_price ?? addon.monthly_price * 12)
                                                        : addon.monthly_price;

                                                    return (
                                                        <label
                                                            key={addon.code}
                                                            className={`flex items-start gap-3 rounded-2xl border p-4 cursor-pointer transition-all ${checked ? 'border-blue-600 bg-white shadow-lg shadow-blue-100' : 'border-blue-100 bg-white/70 hover:border-blue-200'}`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => toggleAddon(addon.code)}
                                                                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                            />
                                                            <div className="min-w-0">
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <span className="text-sm font-black text-gray-900">{addon.name}</span>
                                                                </div>
                                                                {addon.description && (
                                                                    <p className="mt-1 text-xs text-gray-500">{addon.description}</p>
                                                                )}
                                                                <p className="mt-2 text-base font-black text-gray-900">
                                                                    {formatBDT(addonPrice, { locale })}
                                                                </p>
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setBillingCycle('MONTHLY')}
                                            className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-widest ${billingCycle === 'MONTHLY' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-blue-100'}`}
                                        >
                                            {copy.monthly}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setBillingCycle('YEARLY')}
                                            className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-widest ${billingCycle === 'YEARLY' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-blue-100'}`}
                                        >
                                            {copy.yearly}
                                        </button>
                                    </div>

                                    {addonsTotal > 0 && (
                                        <p className="text-xs font-semibold text-blue-900">
                                            Includes {formatBDT(addonsTotal, { locale })} in selected add-ons.
                                        </p>
                                    )}

                                    <div className="flex flex-wrap gap-3">
                                        <button
                                            type="button"
                                            onClick={startCheckout}
                                            disabled={isSubmitting}
                                            className="inline-flex items-center rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:opacity-60"
                                        >
                                            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CreditCard className="w-4 h-4 mr-2" />}
                                            {isSslProvider ? copy.continueSsl : copy.startSandbox}
                                        </button>

                                        {activeReference && !isSslProvider && (
                                            <button
                                                type="button"
                                                onClick={confirmCheckout}
                                                disabled={isSubmitting}
                                                className="inline-flex items-center rounded-2xl bg-white px-5 py-3 text-sm font-black text-gray-900 border border-gray-200 transition hover:border-blue-300 disabled:opacity-60"
                                            >
                                                <ArrowUpRight className="w-4 h-4 mr-2" />
                                                {copy.confirmCheckout}
                                            </button>
                                        )}

                                        {summary.subscription && !summary.subscription.cancel_at_period_end && (
                                            <button
                                                type="button"
                                                onClick={cancelAtPeriodEnd}
                                                disabled={isSubmitting}
                                                className="inline-flex items-center rounded-2xl bg-white px-5 py-3 text-sm font-black text-rose-700 border border-rose-200 transition hover:bg-rose-50 disabled:opacity-60"
                                            >
                                                <RotateCcw className="w-4 h-4 mr-2" />
                                                {copy.cancelAtPeriodEnd}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-3xl border border-gray-200 bg-gray-50 px-5 py-4 text-sm text-gray-600">
                                    {formatMessage(copy.roleRestricted, { role: summary.role })}
                                </div>
                            )}
                        </section>

                        <aside className="rounded-3xl border border-gray-100 bg-white p-6 space-y-4 h-fit">
                            <div>
                                <p className="text-xs font-medium text-gray-500">{copy.checkoutContext}</p>
                                <h3 className="mt-2 text-lg font-black tracking-tight">{isSslProvider ? copy.hostedProvider : copy.manualSandbox}</h3>
                                <p className="mt-2 text-sm text-gray-500">
                                    {isSslProvider ? copy.hostedProviderDescription : copy.manualSandboxDescription}
                                </p>
                            </div>

                            <div className="rounded-2xl bg-gray-50 p-4 space-y-2 text-sm text-gray-600">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-semibold">{copy.reference}</span>
                                    <span className="font-mono text-xs text-gray-500">{activeReference || copy.notStarted}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-semibold">{copy.selectedPlan}</span>
                                    <span>{selectedPlan?.name || copy.unavailable}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-semibold">{copy.cycle}</span>
                                    <span>{billingCycle}</span>
                                </div>
                            </div>

                            {summary.billing_history && summary.billing_history.length > 0 && (
                                <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
                                    <p className="text-xs font-medium text-gray-500">{copy.recentBillingEvents}</p>
                                    <div className="space-y-2">
                                        {summary.billing_history.map((event: any) => (
                                            <div key={event.id} className="rounded-xl bg-gray-50 px-3 py-2">
                                                <div className="flex items-center justify-between gap-3 text-sm">
                                                    <span className="font-black text-gray-900">{event.event_type}</span>
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{event.status}</span>
                                                </div>
                                                <p className="mt-1 text-xs text-gray-500">
                                                    {formatDate(event.created_at, locale)}
                                                    {event.amount != null && event.currency
                                                        ? ` · ${formatBDT(event.amount, { locale })}`
                                                        : ''}
                                                    {event.reference_id ? ` · ${event.reference_id}` : ''}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                {isSslProvider ? copy.sslCallbackNote : copy.manualWebhookNote}
                            </div>
                        </aside>
                    </div>
                )}
            </div>
        </div>
    );
}

function BillingPageFallback() {
    const { t } = useI18n();
    const copy = t.billing;

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-6xl mx-auto">
                <div className="rounded-3xl border border-gray-100 bg-white p-8 flex items-center justify-center text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> {copy.loadingWorkspace}
                </div>
            </div>
        </div>
    );
}

function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className="mt-2 text-lg font-black text-gray-900">{value}</p>
        </div>
    );
}