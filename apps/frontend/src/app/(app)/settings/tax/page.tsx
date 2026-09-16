'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import { useState, useEffect } from 'react';
import { Receipt } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import { Alert, Button, Checkbox, Field, Input, PageShell, Textarea } from '@/components/ui';

export default function TaxSettingsPage() {
    const { t } = useI18n();
    const m = t.settingsExtras.tax;
    const [vatRate, setVatRate] = useState('');
    const [vatRegNo, setVatRegNo] = useState('');
    const [businessTin, setBusinessTin] = useState('');
    // The Mushak issuer block. Kept on this screen rather than its own: a shop
    // filling in its BIN is the same shop deciding who signs its চালানপত্র, and
    // splitting the two leaves half-configured workspaces printing documents
    // NBR will not accept.
    const [mushakEnabled, setMushakEnabled] = useState(false);
    const [issueAddress, setIssueAddress] = useState('');
    const [officerName, setOfficerName] = useState('');
    const [officerDesignation, setOfficerDesignation] = useState('');
    const [economicActivity, setEconomicActivity] = useState('');
    const [missing, setMissing] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchWithAuth('/tenants/tax-settings')
            .then(d => {
                setVatRate(d?.default_vat_rate != null ? String(d.default_vat_rate) : '');
                setVatRegNo(d?.vat_registration_no ?? '');
                setBusinessTin(d?.business_tin ?? '');
                setMushakEnabled(d?.mushak_enabled ?? false);
                setIssueAddress(d?.mushak_issue_address ?? '');
                setOfficerName(d?.mushak_officer_name ?? '');
                setOfficerDesignation(d?.mushak_officer_designation ?? '');
                setEconomicActivity(d?.mushak_economic_activity ?? '');
                setMissing(d?.mushak_readiness?.missing ?? []);
            })
            .catch(() => setError(m.loadFailed))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        setError('');
        try {
            const rate = vatRate === '' ? null : parseFloat(vatRate);
            if (rate !== null && (isNaN(rate) || rate < 0 || rate > 100)) {
                setError(m.vatRateInvalid);
                return;
            }
            const saved = await fetchWithAuth('/tenants/tax-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    default_vat_rate: rate,
                    vat_registration_no: vatRegNo || null,
                    business_tin: businessTin || null,
                    mushak_enabled: mushakEnabled,
                    mushak_issue_address: issueAddress || null,
                    mushak_officer_name: officerName || null,
                    mushak_officer_designation: officerDesignation || null,
                    mushak_economic_activity: economicActivity || null,
                }),
            });
            // Re-read rather than re-deriving here: the same check runs on the
            // document endpoints, so the list shown is the one that will
            // actually block a 6.3.
            setMissing(saved?.mushak_readiness?.missing ?? []);
            toast.success(m.savedSuccess);
        } catch (e: any) {
            setError(e.message ?? m.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    return (
        <PageShell maxWidth="full" className="space-y-4">
            <PageHeader
                title={(
                    <span className="inline-flex items-center gap-2">
                        <Receipt className="h-6 w-6 text-gray-600" />
                        {m.title}
                    </span>
                )}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    m.title,
                    'settings',
                )}
            />

            <Alert tone="info">
                <strong>{m.complianceTitle}</strong> — {m.complianceBody}
            </Alert>

            {loading ? (
                <div className="text-gray-500 py-8 text-center">{m.loading}</div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
                    <Field label={m.vatRate.label} hint={m.vatRate.hint} className="max-w-xs">
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={vatRate}
                                onChange={e => setVatRate(e.target.value)}
                                placeholder={m.vatRate.placeholder}
                            />
                            <span className="text-gray-500 text-sm">%</span>
                        </div>
                    </Field>

                    <Field label={m.vatReg.label} hint={m.vatReg.hint} className="max-w-sm">
                        <Input
                            type="text"
                            value={vatRegNo}
                            onChange={e => setVatRegNo(e.target.value)}
                            placeholder={m.vatReg.placeholder}
                        />
                    </Field>

                    <Field label={m.tin.label} hint={m.tin.hint12Digit} className="max-w-sm">
                        <Input
                            type="text"
                            value={businessTin}
                            onChange={e => setBusinessTin(e.target.value)}
                            placeholder={m.tin.placeholder}
                        />
                    </Field>

                    {error && <Alert tone="danger">{error}</Alert>}

                    <div className="pt-2">
                        <Button onClick={handleSave} disabled={saving} loading={saving}>
                            {saving ? m.saving : m.saveButton}
                        </Button>
                    </div>
                </div>
            )}

            {!loading && (
                <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
                    <div>
                        <h2 className="text-sm font-semibold text-gray-800">{m.mushak.title}</h2>
                        <p className="mt-1 text-xs text-gray-500">{m.mushak.body}</p>
                    </div>

                    <Field label={m.mushak.enable.label} hint={m.mushak.enable.hint}>
                        <Checkbox
                            checked={mushakEnabled}
                            onChange={e => setMushakEnabled(e.target.checked)}
                        />
                    </Field>

                    <Field label={m.mushak.issueAddress.label} hint={m.mushak.issueAddress.hint} className="max-w-xl">
                        <Textarea
                            rows={2}
                            value={issueAddress}
                            onChange={e => setIssueAddress(e.target.value)}
                            placeholder={m.mushak.issueAddress.placeholder}
                        />
                    </Field>

                    <div className="grid gap-4 md:grid-cols-2 max-w-xl">
                        <Field label={m.mushak.officerName.label} hint={m.mushak.officerName.hint}>
                            <Input
                                type="text"
                                value={officerName}
                                onChange={e => setOfficerName(e.target.value)}
                                placeholder={m.mushak.officerName.placeholder}
                            />
                        </Field>
                        <Field label={m.mushak.officerDesignation.label} hint={m.mushak.officerDesignation.hint}>
                            <Input
                                type="text"
                                value={officerDesignation}
                                onChange={e => setOfficerDesignation(e.target.value)}
                                placeholder={m.mushak.officerDesignation.placeholder}
                            />
                        </Field>
                    </div>

                    <Field
                        label={m.mushak.economicActivity.label}
                        hint={m.mushak.economicActivity.hint}
                        className="max-w-sm"
                    >
                        <Input
                            type="text"
                            value={economicActivity}
                            onChange={e => setEconomicActivity(e.target.value)}
                            placeholder={m.mushak.economicActivity.placeholder}
                        />
                    </Field>

                    {missing.length > 0 ? (
                        <Alert tone="warning">
                            {m.mushak.incomplete}{' '}
                            <span className="font-mono">{missing.join(', ')}</span>
                        </Alert>
                    ) : (
                        <Alert tone="success">{m.mushak.ready}</Alert>
                    )}
                </div>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 text-sm space-y-3">
                <h2 className="font-semibold text-gray-800">{m.checklist.title}</h2>
                <ul className="space-y-2 text-gray-600">
                    <li className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span>{m.checklist.items[0]}</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span>{m.checklist.items[1]}</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span>{m.checklist.items[2]}</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">→</span>
                        <span>{m.checklist.items[3]}</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">→</span>
                        <span>{m.checklist.items[4]}</span>
                    </li>
                </ul>
            </div>
        </PageShell>
    );
}
