'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import {
    defaultPlanFeatures,
    normalizePlanFeatures,
    PLAN_ENTITLEMENT_GROUP_ORDER,
    PLAN_ENTITLEMENT_REGISTRY,
    type PlanEntitlementDefinition,
    type PlanEntitlementGroup,
} from '@erp71/shared-types';

type AdminAddon = {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    category?: string | null;
    monthly_price: number;
    yearly_price?: number | null;
    is_active: boolean;
    sort_order: number;
    features_json: Record<string, boolean | number>;
    subscriber_count: number;
};

type AddonDraft = {
    code: string;
    name: string;
    description: string;
    category: string;
    monthly_price: string;
    yearly_price: string;
    is_active: boolean;
    sort_order: string;
    features: Record<string, boolean | number>;
};

const NEW_ADDON_ID = '__new__';

function emptyDraft(): AddonDraft {
    return {
        code: '',
        name: '',
        description: '',
        category: '',
        monthly_price: '0',
        yearly_price: '',
        is_active: true,
        sort_order: '0',
        features: defaultPlanFeatures(),
    };
}

function addonToDraft(addon: AdminAddon): AddonDraft {
    return {
        code: addon.code,
        name: addon.name,
        description: addon.description ?? '',
        category: addon.category ?? '',
        monthly_price: String(addon.monthly_price),
        yearly_price: addon.yearly_price == null ? '' : String(addon.yearly_price),
        is_active: addon.is_active,
        sort_order: String(addon.sort_order),
        features: normalizePlanFeatures(addon.features_json),
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

export default function PlatformAddonModulesPage() {
    const { t } = useI18n();
    const c = t.admin.platformSettings.common;
    const [addons, setAddons] = useState<AdminAddon[]>([]);
    const [entitlements, setEntitlements] = useState<PlanEntitlementDefinition[]>([]);
    const [selectedId, setSelectedId] = useState<string>(NEW_ADDON_ID);
    const [draft, setDraft] = useState<AddonDraft | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const selectedAddon = useMemo(
        () => addons.find((addon) => addon.id === selectedId) ?? null,
        [addons, selectedId],
    );
    const isCreating = selectedId === NEW_ADDON_ID;

    const loadAddons = useCallback(async () => {
        setLoading(true);
        try {
            const [addonsResponse, registryResponse] = await Promise.all([
                api.getAdminAddonModules(),
                api.getAdminSubscriptionPlanRegistry(),
            ]);
            const nextAddons = (addonsResponse ?? []) as AdminAddon[];
            setAddons(nextAddons);
            setEntitlements(registryResponse?.entitlements ?? []);
        } catch {
            toast.error(c.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [c.loadFailed]);

    useEffect(() => {
        loadAddons();
    }, [loadAddons]);

    useEffect(() => {
        setDraft(isCreating ? emptyDraft() : selectedAddon ? addonToDraft(selectedAddon) : null);
    }, [isCreating, selectedAddon]);

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

        if (!draft.code.trim() || !draft.name.trim()) {
            toast.error('Code and name are required.');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                name: draft.name.trim(),
                description: draft.description.trim() || null,
                category: draft.category.trim() || null,
                monthly_price: Number(draft.monthly_price),
                yearly_price: draft.yearly_price.trim() === '' ? null : Number(draft.yearly_price),
                is_active: draft.is_active,
                sort_order: Number(draft.sort_order) || 0,
                features: draft.features,
            };

            if (isCreating) {
                const created = await api.createAdminAddonModule({ ...payload, code: draft.code.trim() });
                setAddons((current) => [...current, created]);
                setSelectedId(created.id);
            } else {
                const updated = await api.updateAdminAddonModule(selectedId, payload);
                setAddons((current) => current.map((addon) => (
                    addon.id === selectedId ? { ...addon, ...updated } : addon
                )));
            }
            toast.success(c.saved);
        } catch {
            toast.error(c.saveFailed);
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
        <PageShell maxWidth="wide">
            <PageHeader
                title="Add-on Modules"
                subtitle="Optional paid modules tenants can purchase on top of any subscription plan — priced and gated independently of the base plan."
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.admin,
                    'admin',
                    [{ label: t.admin.platformSettings.index.title, href: routes.admin.platformSettings.root }],
                    'Add-on Modules',
                )}
            />

            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                Price and entitlement changes apply to new purchases immediately. Existing tenant add-on
                    subscriptions keep their current price and entitlements until they renew or repurchase.
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16 text-gray-500">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        {c.loading}
                    </div>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
                        <div className="rounded-2xl border border-gray-200 bg-white p-2 space-y-1 h-fit">
                            <button
                                type="button"
                                onClick={() => setSelectedId(NEW_ADDON_ID)}
                                className={`w-full flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold transition-colors ${
                                    isCreating ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50 text-blue-600'
                                }`}
                            >
                                <Plus className="w-4 h-4" /> New Add-on
                            </button>
                            {addons.map((addon) => {
                                const active = addon.id === selectedId;
                                return (
                                    <button
                                        key={addon.id}
                                        type="button"
                                        onClick={() => setSelectedId(addon.id)}
                                        className={`w-full rounded-xl px-3 py-3 text-left transition-colors ${
                                            active ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50 text-gray-700'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-bold tracking-tight">{addon.name}</span>
                                            {!addon.is_active ? (
                                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                                    Hidden
                                                </span>
                                            ) : null}
                                        </div>
                                        <p className="mt-1 text-[11px] font-medium text-gray-500">
                                            {formatBDT(addon.monthly_price)}/mo
                                        </p>
                                        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                            {addon.subscriber_count} subscribers
                                        </p>
                                    </button>
                                );
                            })}
                        </div>

                        {draft ? (
                            <div className="rounded-2xl border border-gray-200 bg-white p-4 md:p-6 space-y-6">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                            {isCreating ? 'New' : draft.code}
                                        </p>
                                        <h2 className="mt-1 text-lg font-black tracking-tight text-gray-900">
                                            {isCreating ? 'Create add-on' : 'Edit add-on'}
                                        </h2>
                                    </div>
                                    <Button
                                        type="button"
                                        onClick={handleSave}
                                        loading={saving}
                                        size="md"
                                    >
                                        {saving ? c.saving : c.saveSettings}
                                    </Button>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Code</span>
                                        <input
                                            value={draft.code}
                                            disabled={!isCreating}
                                            placeholder="e.g. MANUFACTURING"
                                            onChange={(event) => setDraft((current) => current ? { ...current, code: event.target.value.toUpperCase() } : current)}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Name</span>
                                        <input
                                            value={draft.name}
                                            onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3 md:col-span-2 md:max-w-xs">
                                        <span className="text-sm font-semibold text-gray-800">Active (purchasable)</span>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={draft.is_active}
                                            onClick={() => setDraft((current) => current ? { ...current, is_active: !current.is_active } : current)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${draft.is_active ? 'bg-blue-600' : 'bg-gray-200'}`}
                                        >
                                            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${draft.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                                        </button>
                                    </label>

                                    <label className="block md:col-span-2">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Description</span>
                                        <textarea
                                            value={draft.description}
                                            onChange={(event) => setDraft((current) => current ? { ...current, description: event.target.value } : current)}
                                            rows={3}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Category</span>
                                        <input
                                            value={draft.category}
                                            placeholder="e.g. operations"
                                            onChange={(event) => setDraft((current) => current ? { ...current, category: event.target.value } : current)}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Sort order</span>
                                        <input
                                            type="number"
                                            value={draft.sort_order}
                                            onChange={(event) => setDraft((current) => current ? { ...current, sort_order: event.target.value } : current)}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Monthly price (৳)</span>
                                        <input
                                            type="number"
                                            min={0}
                                            value={draft.monthly_price}
                                            onChange={(event) => setDraft((current) => current ? { ...current, monthly_price: event.target.value } : current)}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Yearly price (৳, optional)</span>
                                        <input
                                            type="number"
                                            min={0}
                                            value={draft.yearly_price}
                                            onChange={(event) => setDraft((current) => current ? { ...current, yearly_price: event.target.value } : current)}
                                            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>
                                </div>

                                <div className="space-y-5">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-500">Entitlements granted</h3>
                                    <p className="text-xs text-gray-500">
                                        Toggle exactly the entitlements this add-on should grant — a tenant on any plan who
                                        purchases it gets these on top of their plan&apos;s own entitlements.
                                    </p>
                                    {groupedEntitlements.map((group) => (
                                        <div key={group.key} className="space-y-3">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400">
                                                {group.key}
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
        </PageShell>
    );
}
