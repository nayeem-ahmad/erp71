'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import {
    defaultPlanFeatures,
    normalizePlanFeatures,
    PLAN_ENTITLEMENT_GROUP_ORDER,
    PLAN_ENTITLEMENT_REGISTRY,
    type FixedSubscriptionPlanCode,
    type PlanEntitlementDefinition,
    type PlanEntitlementGroup,
} from '@erp71/shared-types';

type AdminPlan = {
    code: FixedSubscriptionPlanCode;
    name: string;
    description?: string | null;
    monthly_price: number;
    yearly_price?: number | null;
    is_active: boolean;
    features_json: Record<string, boolean | number>;
    marketing_features?: string[];
    subscriber_count: number;
};

type PlanDraft = {
    name: string;
    description: string;
    monthly_price: string;
    yearly_price: string;
    is_active: boolean;
    features: Record<string, boolean | number>;
    marketing_features: string[];
};

function planToDraft(plan: AdminPlan): PlanDraft {
    const features = normalizePlanFeatures(plan.features_json, plan.code);
    return {
        name: plan.name,
        description: plan.description ?? '',
        monthly_price: String(plan.monthly_price),
        yearly_price: plan.yearly_price == null ? '' : String(plan.yearly_price),
        is_active: plan.is_active,
        features,
        marketing_features: plan.marketing_features?.length ? [...plan.marketing_features] : [''],
    };
}

function EntitlementField({
    definition,
    value,
    onChange,
}: {
    definition: PlanEntitlementDefinition;
    value: boolean | number;
    onChange: (next: boolean | number) => void;
}) {
    if (definition.type === 'boolean') {
        const enabled = Boolean(value);
        return (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 bg-white px-4 py-3">
                <div>
                    <p className="text-sm font-semibold text-gray-800">{definition.label}</p>
                    {definition.description ? (
                        <p className="mt-0.5 text-xs text-gray-500">{definition.description}</p>
                    ) : null}
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => onChange(!enabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${enabled ? 'bg-blue-600' : 'bg-gray-200'}`}
                >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
            </div>
        );
    }

    return (
        <label className="block rounded-xl border border-gray-100 bg-white px-4 py-3">
            <span className="text-sm font-semibold text-gray-800">{definition.label}</span>
            {definition.description ? (
                <span className="mt-0.5 block text-xs text-gray-500">{definition.description}</span>
            ) : null}
            <input
                type="number"
                value={Number(value)}
                min={definition.min}
                max={definition.max}
                onChange={(event) => onChange(Number(event.target.value))}
                className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
        </label>
    );
}

export default function PlatformSubscriptionPlansPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.plans;
    const [plans, setPlans] = useState<AdminPlan[]>([]);
    const [entitlements, setEntitlements] = useState<PlanEntitlementDefinition[]>([]);
    const [selectedCode, setSelectedCode] = useState<FixedSubscriptionPlanCode>('FREE');
    const [draft, setDraft] = useState<PlanDraft | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const selectedPlan = useMemo(
        () => plans.find((plan) => plan.code === selectedCode) ?? null,
        [plans, selectedCode],
    );

    const loadPlans = useCallback(async () => {
        setLoading(true);
        try {
            const [plansResponse, registryResponse] = await Promise.all([
                api.getAdminSubscriptionPlans(),
                api.getAdminSubscriptionPlanRegistry(),
            ]);
            const nextPlans = (plansResponse?.plans ?? []) as AdminPlan[];
            setPlans(nextPlans);
            setEntitlements(registryResponse?.entitlements ?? []);
            const initial = nextPlans[0]?.code ?? 'FREE';
            setSelectedCode((current) => nextPlans.some((plan) => plan.code === current) ? current : initial);
        } catch {
            toast.error(t.admin.platformSettings.common.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [t.admin.platformSettings.common.loadFailed]);

    useEffect(() => {
        loadPlans();
    }, [loadPlans]);

    useEffect(() => {
        if (!selectedPlan) {
            setDraft(null);
            return;
        }
        setDraft(planToDraft(selectedPlan));
    }, [selectedPlan]);

    const isFreePlan = selectedCode === 'FREE';

    const groupedEntitlements = useMemo(() => {
        const source: PlanEntitlementDefinition[] = entitlements.length
            ? entitlements
            : PLAN_ENTITLEMENT_REGISTRY;
        const groups = new Map<PlanEntitlementGroup | 'other', PlanEntitlementDefinition[]>();
        for (const definition of source) {
            const group = definition.group ?? 'other';
            const bucket = groups.get(group) ?? [];
            bucket.push(definition);
            groups.set(group, bucket);
        }
        const orderedGroups: Array<{ key: PlanEntitlementGroup | 'other'; items: PlanEntitlementDefinition[] }> = [];
        for (const group of PLAN_ENTITLEMENT_GROUP_ORDER) {
            const items = groups.get(group);
            if (items?.length) {
                orderedGroups.push({ key: group, items });
            }
        }
        const other = groups.get('other');
        if (other?.length) {
            orderedGroups.push({ key: 'other', items: other });
        }
        return orderedGroups;
    }, [entitlements]);

    const handleSave = async () => {
        if (!draft) return;

        setSaving(true);
        try {
            const payload = {
                name: draft.name.trim(),
                description: draft.description.trim() || null,
                monthly_price: Number(draft.monthly_price),
                yearly_price: draft.yearly_price.trim() === '' ? null : Number(draft.yearly_price),
                is_active: draft.is_active,
                features: draft.features,
                marketing_features: draft.marketing_features
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0),
            };

            const updated = await api.updateAdminSubscriptionPlan(selectedCode, payload);
            setPlans((current) => current.map((plan) => (
                plan.code === selectedCode ? { ...plan, ...updated } : plan
            )));
            toast.success(t.admin.platformSettings.common.saved);
        } catch {
            toast.error(t.admin.platformSettings.common.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const updateFeature = (key: string, value: boolean | number) => {
        setDraft((current) => (
            current
                ? { ...current, features: { ...current.features, [key]: value } }
                : current
        ));
    };

    return (
        <PageShell>
            <div className="max-w-6xl mx-auto space-y-6">
                <PageHeader
                    title={m.title}
                    subtitle={m.description}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: t.admin.platformSettings.index.title, href: routes.admin.platformSettings.root }],
                        m.title,
                    )}
                />


                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                    {m.notice}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16 text-gray-500">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        {t.admin.platformSettings.common.loading}
                    </div>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
                        <div className="rounded-2xl border border-gray-200 bg-white p-2 space-y-1 h-fit">
                            {plans.map((plan) => {
                                const active = plan.code === selectedCode;
                                return (
                                    <button
                                        key={plan.code}
                                        type="button"
                                        onClick={() => setSelectedCode(plan.code)}
                                        className={`w-full rounded-xl px-3 py-3 text-left transition-colors ${
                                            active ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50 text-gray-700'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-bold tracking-tight">{plan.name}</span>
                                            {!plan.is_active ? (
                                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                                    {m.inactiveBadge}
                                                </span>
                                            ) : null}
                                        </div>
                                        <p className="mt-1 text-[11px] font-medium text-gray-500">
                                            {formatBDT(plan.monthly_price)}{m.perMonth}
                                        </p>
                                        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                            {formatMessage(m.subscribersLabel, { count: plan.subscriber_count })}
                                        </p>
                                    </button>
                                );
                            })}
                        </div>

                        {draft ? (
                            <div className="rounded-2xl border border-gray-200 bg-white p-4 md:p-6 space-y-6">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{selectedCode}</p>
                                        <h2 className="mt-1 text-lg font-black tracking-tight text-gray-900">{m.editPlan}</h2>
                                    </div>
                                    <Button type="button" onClick={handleSave} loading={saving} size="md">
                                        {saving ? t.admin.platformSettings.common.saving : t.admin.platformSettings.common.saveSettings}
                                    </Button>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">{m.fields.name}</span>
                                        <input
                                            value={draft.name}
                                            onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3 md:col-span-2 md:max-w-xs">
                                        <span className="text-sm font-semibold text-gray-800">{m.fields.active}</span>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={draft.is_active}
                                            disabled={isFreePlan}
                                            onClick={() => setDraft((current) => current ? { ...current, is_active: !current.is_active } : current)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${draft.is_active ? 'bg-blue-600' : 'bg-gray-200'}`}
                                        >
                                            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${draft.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                                        </button>
                                    </label>

                                    <label className="block md:col-span-2">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">{m.fields.description}</span>
                                        <textarea
                                            value={draft.description}
                                            onChange={(event) => setDraft((current) => current ? { ...current, description: event.target.value } : current)}
                                            rows={3}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">{m.fields.monthlyPrice}</span>
                                        <input
                                            type="number"
                                            min={0}
                                            disabled={isFreePlan}
                                            value={draft.monthly_price}
                                            onChange={(event) => setDraft((current) => current ? { ...current, monthly_price: event.target.value } : current)}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">{m.fields.yearlyPrice}</span>
                                        <input
                                            type="number"
                                            min={0}
                                            disabled={isFreePlan}
                                            value={draft.yearly_price}
                                            onChange={(event) => setDraft((current) => current ? { ...current, yearly_price: event.target.value } : current)}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
                                        />
                                    </label>
                                </div>

                                {isFreePlan ? (
                                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                                        {m.freePlanNotice}
                                    </p>
                                ) : null}

                                <div className="space-y-3">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-500">{m.marketingFeaturesTitle}</h3>
                                    <p className="text-xs text-gray-500">{m.marketingFeaturesHint}</p>
                                    <div className="space-y-2">
                                        {draft.marketing_features.map((line, index) => (
                                            <div key={`marketing-${index}`} className="flex gap-2">
                                                <input
                                                    value={line}
                                                    onChange={(event) => setDraft((current) => {
                                                        if (!current) return current;
                                                        const next = [...current.marketing_features];
                                                        next[index] = event.target.value;
                                                        return { ...current, marketing_features: next };
                                                    })}
                                                    placeholder={m.marketingFeaturePlaceholder}
                                                    className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setDraft((current) => {
                                                        if (!current) return current;
                                                        const next = current.marketing_features.filter((_, i) => i !== index);
                                                        return { ...current, marketing_features: next.length ? next : [''] };
                                                    })}
                                                    className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50"
                                                >
                                                    {m.removeMarketingFeature}
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setDraft((current) => (
                                                current
                                                    ? { ...current, marketing_features: [...current.marketing_features, ''] }
                                                    : current
                                            ))}
                                            className="rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                                        >
                                            {m.addMarketingFeature}
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-5">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-500">{m.entitlementsTitle}</h3>
                                    {groupedEntitlements.map((group) => (
                                        <div key={group.key} className="space-y-3">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400">
                                                {m.entitlementGroups[group.key]}
                                            </h4>
                                            <div className="grid gap-3 md:grid-cols-2">
                                                {group.items.map((definition) => (
                                                    <EntitlementField
                                                        key={definition.key}
                                                        definition={definition}
                                                        value={draft.features[definition.key] ?? definition.defaultValue}
                                                        onChange={(next) => updateFeature(definition.key, next)}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </PageShell>
    );
}