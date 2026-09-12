'use client';

import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import {
    DEFAULT_PASSWORD_POLICY,
    PASSWORD_MAX_MIN_LENGTH,
    PASSWORD_MIN_LENGTH_FLOOR,
    evaluatePassword,
    type PasswordPolicy,
} from '@erp71/shared-types';

import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import { Alert, Button, Input, PageHeader, PageShell, PasswordRequirements, Switch } from '@/components/ui';

/** The switches, in the order the form lists them. */
const TOGGLES = [
    { key: 'require_uppercase', labelKey: 'requireUppercase' },
    { key: 'require_lowercase', labelKey: 'requireLowercase' },
    { key: 'require_number', labelKey: 'requireNumber' },
    { key: 'require_symbol', labelKey: 'requireSymbol' },
    { key: 'block_common', labelKey: 'blockCommon' },
] as const;

export default function PasswordPolicySettingsPage() {
    const { t } = useI18n();
    const s = t.settings.passwordPolicy;

    const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [forbidden, setForbidden] = useState(false);
    const [sample, setSample] = useState('');

    useEffect(() => {
        let active = true;
        api.getTenantPasswordPolicy()
            .then((loaded) => {
                if (active) setPolicy(loaded);
            })
            .catch(() => {
                if (active) toast.error(s.loadFailed);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [s.loadFailed]);

    const minLengthError = useMemo(() => {
        if (policy.min_length < PASSWORD_MIN_LENGTH_FLOOR) {
            return s.minLengthFloor.replace('{count}', String(PASSWORD_MIN_LENGTH_FLOOR));
        }
        if (policy.min_length > PASSWORD_MAX_MIN_LENGTH) {
            return s.minLengthCeiling.replace('{count}', String(PASSWORD_MAX_MIN_LENGTH));
        }
        return null;
    }, [policy.min_length, s.minLengthCeiling, s.minLengthFloor]);

    const save = async () => {
        if (minLengthError) return;
        setSaving(true);
        try {
            setPolicy(await api.updateTenantPasswordPolicy(policy));
            setForbidden(false);
            toast.success(s.saved);
        } catch (error: any) {
            // A cashier who reaches this page by URL gets the explanation in
            // place, not a toast that scrolls away.
            if (error?.status === 403) setForbidden(true);
            else toast.error(error?.message || s.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <PageShell maxWidth="wide">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {s.loading}
                </div>
            </PageShell>
        );
    }

    return (
        <PageShell maxWidth="wide" className="space-y-4">
            <PageHeader
                title={s.title}
                subtitle={s.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    s.title,
                    'settings',
                )}
            />

            {forbidden && <Alert tone="warning">{s.adminOnly}</Alert>}

            <Alert tone="info">{s.appliesNext}</Alert>

            <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 space-y-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <KeyRound className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-gray-900">{s.rulesHeading}</h2>
                        <p className="text-xs text-gray-500 mt-0.5">{s.rulesHelp}</p>
                    </div>
                </div>

                <div className="max-w-xs">
                    <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="password-min-length">
                        {s.minLengthLabel}
                    </label>
                    <Input
                        id="password-min-length"
                        type="number"
                        inputMode="numeric"
                        min={PASSWORD_MIN_LENGTH_FLOOR}
                        max={PASSWORD_MAX_MIN_LENGTH}
                        value={String(policy.min_length)}
                        onChange={(event) =>
                            setPolicy((current) => ({
                                ...current,
                                min_length: Number(event.target.value),
                            }))
                        }
                    />
                    {minLengthError ? (
                        <p className="mt-1 text-xs text-red-600">{minLengthError}</p>
                    ) : (
                        <p className="mt-1 text-xs text-gray-500">
                            {s.minLengthHint.replace('{count}', String(PASSWORD_MIN_LENGTH_FLOOR))}
                        </p>
                    )}
                </div>

                <div className="divide-y divide-gray-100 border-t border-gray-100">
                    {TOGGLES.map(({ key, labelKey }) => (
                        <label
                            key={key}
                            className="flex min-h-touch items-center justify-between gap-4 py-3"
                            htmlFor={`password-${key}`}
                        >
                            <span>
                                <span className="block text-sm text-gray-900">{s.toggles[labelKey].label}</span>
                                <span className="block text-xs text-gray-500">{s.toggles[labelKey].help}</span>
                            </span>
                            <Switch
                                id={`password-${key}`}
                                checked={policy[key]}
                                onCheckedChange={(checked) =>
                                    setPolicy((current) => ({ ...current, [key]: checked }))
                                }
                            />
                        </label>
                    ))}
                </div>

                <Button onClick={save} disabled={saving || Boolean(minLengthError)} loading={saving}>
                    {s.save}
                </Button>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 space-y-3">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                        <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-gray-900">{s.previewHeading}</h2>
                        {/* Typing a candidate here is the only way to see what the
                            rule you just wrote actually demands of your team. */}
                        <p className="text-xs text-gray-500 mt-0.5">{s.previewHelp}</p>
                    </div>
                </div>

                <div className="max-w-md space-y-2">
                    <Input
                        type="text"
                        autoComplete="off"
                        placeholder={s.previewPlaceholder}
                        value={sample}
                        onChange={(event) => setSample(event.target.value)}
                    />
                    <PasswordRequirements password={sample} policy={policy} touched={sample.length > 0} />
                    {sample.length > 0 && (
                        <p className="text-xs font-medium text-gray-700">
                            {evaluatePassword(sample, policy).valid ? s.previewPass : s.previewFail}
                        </p>
                    )}
                </div>
            </section>
        </PageShell>
    );
}
