'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { AccountingPageShell, CompactSection } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button, Checkbox } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { isOwner } from '@/lib/permissions';
import { toast } from '@/lib/toast';

type AccountingSettings = {
    requireVoucherApproval: boolean;
    autoApproveSystemVouchers: boolean;
    reportsApprovedOnly: boolean;
};

const DEFAULTS: AccountingSettings = {
    requireVoucherApproval: false,
    autoApproveSystemVouchers: true,
    reportsApprovedOnly: false,
};

export default function AccountingSettingsPage() {
    const { t } = useI18n();
    const copy = t.accountingSettings;

    const [settings, setSettings] = useState<AccountingSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [canEdit, setCanEdit] = useState(false);

    const load = useCallback(async () => {
        try {
            const [data, me] = await Promise.all([api.getAccountingSettings(), api.getMe()]);
            const tenantId = localStorage.getItem('tenant_id');
            const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === tenantId) ?? me?.tenants?.[0];
            setCanEdit(isOwner(tenant?.role));
            setSettings({
                requireVoucherApproval: Boolean(data?.requireVoucherApproval),
                autoApproveSystemVouchers: data?.autoApproveSystemVouchers !== false,
                reportsApprovedOnly: Boolean(data?.reportsApprovedOnly),
            });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [copy.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleSave = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        try {
            await api.updateAccountingSettings(settings);
            toast.success(copy.saved);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const toggle = (key: keyof AccountingSettings) => (event: React.ChangeEvent<HTMLInputElement>) => {
        setSettings((current) => ({ ...current, [key]: event.target.checked }));
    };

    return (
        <AccountingPageShell maxWidth="narrow">
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    copy.title,
                    'accounting',
                )}
            />

            {loading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t.accountingShared.loading}
                </div>
            ) : (
                <form onSubmit={handleSave} className="space-y-4">
                    {!canEdit ? (
                        <CompactSection className="border-amber-100 bg-amber-50/50">
                            <div className="flex items-start gap-2">
                                <ShieldCheck className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                                <p className="text-xs text-amber-800">{copy.ownerOnly}</p>
                            </div>
                        </CompactSection>
                    ) : null}

                    <CompactSection title={copy.approvalHeading}>
                        <div className="space-y-4">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <Checkbox
                                    checked={settings.requireVoucherApproval}
                                    onChange={toggle('requireVoucherApproval')}
                                    disabled={!canEdit}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span className="block text-sm font-semibold text-gray-700">{copy.requireApproval}</span>
                                    <span className="block mt-1 text-xs text-gray-500">{copy.requireApprovalHint}</span>
                                </span>
                            </label>

                            <label className={`flex items-start gap-3 ${settings.requireVoucherApproval ? 'cursor-pointer' : 'opacity-50'}`}>
                                <Checkbox
                                    checked={settings.autoApproveSystemVouchers}
                                    onChange={toggle('autoApproveSystemVouchers')}
                                    disabled={!canEdit || !settings.requireVoucherApproval}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span className="block text-sm font-semibold text-gray-700">{copy.autoApproveSystem}</span>
                                    <span className="block mt-1 text-xs text-gray-500">{copy.autoApproveSystemHint}</span>
                                </span>
                            </label>
                        </div>
                    </CompactSection>

                    <CompactSection title={copy.reportsHeading}>
                        <label className="flex items-start gap-3 cursor-pointer">
                            <Checkbox
                                checked={settings.reportsApprovedOnly}
                                onChange={toggle('reportsApprovedOnly')}
                                disabled={!canEdit}
                                className="mt-0.5"
                            />
                            <span>
                                <span className="block text-sm font-semibold text-gray-700">{copy.reportsApprovedOnly}</span>
                                <span className="block mt-1 text-xs text-gray-500">{copy.reportsApprovedOnlyHint}</span>
                            </span>
                        </label>
                    </CompactSection>

                    {canEdit ? (
                        <div className="flex justify-end">
                            <Button type="submit" disabled={saving} loading={saving}>
                                {saving ? copy.saving : copy.save}
                            </Button>
                        </div>
                    ) : null}
                </form>
            )}
        </AccountingPageShell>
    );
}
