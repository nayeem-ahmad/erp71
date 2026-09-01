'use client';

import { Loader2 } from 'lucide-react';
import CompactSection from '@/components/ui/compact/CompactSection';
import { Button, Field, Input, Select, Checkbox } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import type { AdminTenantAddonSubscription } from '@/lib/api';
import type { DiscountType, PlanCode, TenantRecord } from '../types';
import type { AddonCatalogEntry, SubscriptionDraft } from '../use-tenant-detail';

type Props = {
    tenant: TenantRecord;
    draft: SubscriptionDraft;
    onDraftChange: (next: SubscriptionDraft) => void;
    addons: AdminTenantAddonSubscription[];
    addonCatalog: AddonCatalogEntry[];
    selectedAddonCode: string;
    onSelectedAddonCodeChange: (code: string) => void;
    addonDurationDays: string;
    onAddonDurationDaysChange: (days: string) => void;
    isGrantingAddon: boolean;
    revokingAddonCode: string | null;
    onGrantAddon: () => void;
    onRevokeAddon: (code: string, name: string) => void;
};

export default function SubscriptionPanel({
    tenant,
    draft,
    onDraftChange,
    addons,
    addonCatalog,
    selectedAddonCode,
    onSelectedAddonCodeChange,
    addonDurationDays,
    onAddonDurationDaysChange,
    isGrantingAddon,
    revokingAddonCode,
    onGrantAddon,
    onRevokeAddon,
}: Props) {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const sc = m.subscriptionControls;
    const ac = m.addonControls;
    const dp = m.detailPage;

    const patch = (part: Partial<SubscriptionDraft>) => onDraftChange({ ...draft, ...part });

    return (
        <div className="space-y-4">
            <CompactSection>
                <p className="text-sm font-semibold text-gray-900">{sc.title}</p>
                {tenant.subscription ? (
                    <p className="mt-0.5 text-xs text-gray-500">
                        {formatMessage(dp.currentPeriod, {
                            start: formatDate(tenant.subscription.current_period_start),
                            end: formatDate(tenant.subscription.current_period_end),
                        })}
                    </p>
                ) : null}

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Field label={m.columns.plan}>
                        <Select
                            value={draft.planCode}
                            onChange={(event) => patch({ planCode: event.target.value as PlanCode })}
                        >
                            <option value="FREE">{m.plans.free}</option>
                            <option value="BASIC">{m.plans.basic}</option>
                            <option value="ACCOUNTING">{m.plans.accounting}</option>
                            <option value="STANDARD">{m.plans.standard}</option>
                            <option value="PREMIUM">{m.plans.premium}</option>
                        </Select>
                    </Field>

                    <Field label={m.columns.status}>
                        <Select
                            value={draft.status}
                            onChange={(event) => patch({
                                status: event.target.value as SubscriptionDraft['status'],
                            })}
                        >
                            <option value="ACTIVE">{m.statuses.active}</option>
                            <option value="TRIALING">{m.statuses.trialing}</option>
                            <option value="PAST_DUE">{m.statuses.pastDue}</option>
                            <option value="CANCELLED">{m.statuses.cancelled}</option>
                        </Select>
                    </Field>

                    <Field label={sc.discountLabel}>
                        <div className="flex gap-2">
                            <Select
                                value={draft.discountMode}
                                onChange={(event) => patch({
                                    discountMode: event.target.value as 'NONE' | DiscountType,
                                })}
                                className="flex-1"
                            >
                                <option value="NONE">{sc.discountNone}</option>
                                <option value="PERCENTAGE">{sc.discountPercent}</option>
                                <option value="FIXED">{sc.discountFixed}</option>
                            </Select>
                            {draft.discountMode !== 'NONE' && (
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={draft.discountValue}
                                    onChange={(event) => patch({ discountValue: event.target.value })}
                                    placeholder={draft.discountMode === 'PERCENTAGE' ? '%' : '৳'}
                                    aria-label={sc.discountLabel}
                                    className="w-24"
                                />
                            )}
                        </div>
                    </Field>
                </div>

                <p className="mt-1.5 text-xs text-gray-500">{sc.discountHint}</p>

                <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 max-md:min-h-touch">
                    <Checkbox
                        checked={draft.cancelAtPeriodEnd}
                        onChange={(event) => patch({ cancelAtPeriodEnd: event.target.checked })}
                    />
                    {sc.cancelAtPeriodEnd}
                </label>
            </CompactSection>

            <CompactSection>
                <p className="text-sm font-semibold text-gray-900">{ac.title}</p>
                <p className="mt-0.5 text-xs text-gray-500">{ac.description}</p>

                <div className="mt-3 space-y-2">
                    {addons.length === 0 ? (
                        <p className="text-xs text-gray-500">{ac.noneActive}</p>
                    ) : addons.map((sub) => (
                        <div
                            key={sub.addon.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
                        >
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-900">{sub.addon.name}</p>
                                <p className="mt-0.5 text-xs text-gray-500">
                                    {formatMessage(ac.activeUntil, { date: formatDate(sub.current_period_end) })}
                                </p>
                            </div>
                            <Button
                                variant="secondary"
                                onClick={() => onRevokeAddon(sub.addon.code, sub.addon.name)}
                                disabled={revokingAddonCode === sub.addon.code}
                                className="!text-danger-text !border-red-200 hover:!bg-danger-light"
                            >
                                {revokingAddonCode === sub.addon.code
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : null}
                                {ac.revoke}
                            </Button>
                        </div>
                    ))}
                </div>

                <div className="mt-3 border-t border-gray-100 pt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div className="md:col-span-2">
                        <Field label={ac.addonLabel}>
                            <Select
                                value={selectedAddonCode}
                                onChange={(event) => onSelectedAddonCodeChange(event.target.value)}
                            >
                                <option value="">{ac.addonPlaceholder}</option>
                                {addonCatalog
                                    .filter((addon) => !addons.some((sub) => sub.addon.code === addon.code))
                                    .map((addon) => (
                                        <option key={addon.id} value={addon.code}>{addon.name}</option>
                                    ))}
                            </Select>
                        </Field>
                    </div>
                    <div className="flex gap-2 items-end">
                        <Field label={ac.durationLabel} className="flex-1">
                            <Input
                                type="number"
                                min="1"
                                value={addonDurationDays}
                                onChange={(event) => onAddonDurationDaysChange(event.target.value)}
                                aria-label={ac.durationLabel}
                            />
                        </Field>
                        <Button
                            onClick={onGrantAddon}
                            disabled={isGrantingAddon || !selectedAddonCode}
                            loading={isGrantingAddon}
                            size="md"
                        >
                            {ac.grant}
                        </Button>
                    </div>
                </div>
            </CompactSection>
        </div>
    );
}
