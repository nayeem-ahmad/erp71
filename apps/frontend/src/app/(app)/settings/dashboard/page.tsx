'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import type { DashboardPreference, DashboardVariant } from '@erp71/shared-types';

import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    canChooseAccountingDashboard,
    canChooseCrmDashboard,
    isAccountingOnlyPlan,
    tenantDashboardVariant,
} from '@/lib/plan-entitlements';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { toast } from '@/lib/toast';
import { Button, PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';

const OPTIONS: DashboardPreference[] = ['AUTO', 'RETAIL', 'ACCOUNTING', 'CRM'];

export default function DashboardSettingsPage() {
    const { t } = useI18n();
    const copy = t.settings.dashboardChoice;
    const { planCode, features, permissions, ready } = useTenantPlanFeatures();

    const [preference, setPreference] = useState<DashboardPreference>('AUTO');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let active = true;

        api.getTenantDashboardSettings()
            .then((settings) => {
                if (!active) return;
                setPreference((settings?.dashboard_preference ?? 'AUTO') as DashboardPreference);
            })
            .catch(() => {
                if (active) toast.error(copy.saveFailed);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [copy.saveFailed]);

    const accountingOnly = isAccountingOnlyPlan(planCode, features);
    const entitled: Record<DashboardPreference, boolean> = {
        AUTO: true,
        RETAIL: true,
        ACCOUNTING: canChooseAccountingDashboard(planCode, features),
        CRM: canChooseCrmDashboard(planCode, features),
    };
    // Four options is where a ternary chain stops being readable, so the labels,
    // help text and the unavailable hint are all keyed off the option itself.
    const labels: Record<DashboardPreference, { label: string; help: string; unavailable?: string }> = {
        AUTO: { label: copy.optionAuto, help: copy.optionAutoHelp },
        RETAIL: { label: copy.optionRetail, help: copy.optionRetailHelp },
        ACCOUNTING: {
            label: copy.optionAccounting,
            help: copy.optionAccountingHelp,
            unavailable: copy.accountingUnavailable,
        },
        CRM: { label: copy.optionCrm, help: copy.optionCrmHelp, unavailable: copy.crmUnavailable },
    };
    const variantNames: Record<DashboardVariant, string> = {
        RETAIL: copy.variantRetail,
        ACCOUNTING: copy.variantAccounting,
        CRM: copy.variantCrm,
    };
    // Shows the resolved answer for the option currently selected, not the saved
    // one, so the consequence of a choice is visible before saving it.
    const resolved = tenantDashboardVariant(planCode, features, preference, permissions);

    const save = async () => {
        setSaving(true);
        try {
            await api.updateTenantDashboardSettings({ dashboard_preference: preference });
            toast.success(copy.saved);
        } catch (error: any) {
            toast.error(error?.message || copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    if (loading || !ready) {
        return (
            <PageShell maxWidth="wide">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {copy.loading}
                </div>
            </PageShell>
        );
    }

    return (
        <PageShell maxWidth="wide" className="space-y-4">
            <PageHeader
                title={copy.title}
                subtitle={copy.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    copy.title,
                    'settings',
                )}
            />

            <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <BarChart3 className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-gray-900">{copy.sectionLabel}</h2>
                        <p className="mt-0.5 text-xs text-gray-500">{copy.sectionHelp}</p>
                    </div>
                </div>

                {accountingOnly ? (
                    <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
                        {copy.accountingOnlyLocked}
                    </p>
                ) : null}

                <div className="space-y-2">
                    {OPTIONS.map((option) => {
                        const { label, help, unavailable } = labels[option];
                        const disabled = accountingOnly || !entitled[option];

                        return (
                            <label
                                key={option}
                                className={`flex min-h-touch cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                                    preference === option
                                        ? 'border-blue-600 bg-blue-50'
                                        : 'border-gray-200 bg-white hover:border-gray-300'
                                } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="dashboard_preference"
                                    className="mt-0.5 h-4 w-4 accent-blue-600"
                                    value={option}
                                    checked={preference === option}
                                    disabled={disabled}
                                    onChange={() => setPreference(option)}
                                />
                                <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-gray-900">{label}</span>
                                    <span className="mt-0.5 block text-xs text-gray-500">{help}</span>
                                    {unavailable && !entitled[option] && !accountingOnly ? (
                                        <span className="mt-1 block text-xs font-semibold text-amber-700">
                                            {unavailable}
                                        </span>
                                    ) : null}
                                </span>
                            </label>
                        );
                    })}
                </div>

                <p className="text-xs font-semibold text-gray-600">
                    {formatMessage(copy.currentlyShowing, { variant: variantNames[resolved] })}
                </p>

                <Button onClick={save} disabled={saving || accountingOnly} loading={saving}>
                    {copy.save}
                </Button>
            </section>
        </PageShell>
    );
}
