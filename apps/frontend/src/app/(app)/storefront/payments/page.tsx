'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
import type { TenantStorefrontGatewayView } from '@erp71/shared-types';
import { Button } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import { fetchWithAuth } from '@/lib/api';
import { toast } from '@/lib/toast';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';

type Draft = {
    enabled: boolean;
    mode: 'sandbox' | 'live';
    credentials: Record<string, string>;
};

const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';

function toDrafts(gateways: TenantStorefrontGatewayView[]): Record<string, Draft> {
    return Object.fromEntries(
        gateways.map((gateway) => [
            gateway.provider_id,
            {
                enabled: gateway.enabled,
                mode: gateway.mode,
                credentials: { ...gateway.credentials },
            },
        ]),
    );
}

export default function StorefrontPaymentsPage() {
    const [gateways, setGateways] = useState<TenantStorefrontGatewayView[] | null>(null);
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [saving, setSaving] = useState<string | null>(null);
    const [testing, setTesting] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const load = async () => {
        const data: TenantStorefrontGatewayView[] = await fetchWithAuth('/tenants/storefront-payment-gateways');
        setGateways(data);
        setDrafts(toDrafts(data));
    };

    useEffect(() => {
        load()
            .catch((error) => setLoadError(error?.message || 'Could not load payment providers.'))
            .finally(() => undefined);
    }, []);

    const updateDraft = (providerId: string, patch: Partial<Draft>) => {
        setDrafts((current) => ({
            ...current,
            [providerId]: { ...current[providerId], ...patch },
        }));
    };

    const updateCredential = (providerId: string, key: string, value: string) => {
        setDrafts((current) => ({
            ...current,
            [providerId]: {
                ...current[providerId],
                credentials: { ...current[providerId].credentials, [key]: value },
            },
        }));
    };

    const save = async (providerId: string) => {
        const draft = drafts[providerId];
        setSaving(providerId);
        try {
            const updated: TenantStorefrontGatewayView = await fetchWithAuth(
                `/tenants/storefront-payment-gateways/${providerId}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(draft),
                },
            );
            setGateways((current) =>
                (current ?? []).map((gateway) => (gateway.provider_id === providerId ? updated : gateway)),
            );
            setDrafts((current) => ({ ...current, [providerId]: {
                enabled: updated.enabled,
                mode: updated.mode,
                credentials: { ...updated.credentials },
            } }));
            toast.success('Payment account saved.');
        } catch (error: any) {
            toast.error(error?.message || 'Could not save this payment account.');
        } finally {
            setSaving(null);
        }
    };

    const test = async (providerId: string) => {
        setTesting(providerId);
        try {
            const updated: TenantStorefrontGatewayView = await fetchWithAuth(
                `/tenants/storefront-payment-gateways/${providerId}/test`,
                { method: 'POST' },
            );
            setGateways((current) =>
                (current ?? []).map((gateway) => (gateway.provider_id === providerId ? updated : gateway)),
            );
            toast.success('Account details look complete.');
        } catch (error: any) {
            toast.error(error?.message || 'Could not verify this payment account.');
        } finally {
            setTesting(null);
        }
    };

    return (
        <PageShell>
            <PageHeader
                title="Online payments"
                subtitle="Connect your own merchant account so customers pay you directly — the money never passes through ERP71."
                breadcrumbs={nestedPageBreadcrumbs(
                    'Home',
                    'Storefront',
                    'storefront',
                    [{ label: 'Settings', href: routes.storefront.settings }],
                    'Online payments',
                )}
                actions={
                    <Link
                        href={routes.storefront.settings}
                        className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Storefront settings
                    </Link>
                }
            />

            {loadError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {loadError}
                </div>
            )}

            {!gateways && !loadError && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading payment providers…
                </div>
            )}

            {gateways && gateways.length === 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
                    No online payment providers are enabled on this platform yet. Cash on delivery is still
                    available at checkout.
                </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
                {(gateways ?? []).map((gateway) => {
                    const draft = drafts[gateway.provider_id];
                    if (!draft) return null;
                    const verified = Boolean(gateway.verified_at);

                    return (
                        <section
                            key={gateway.provider_id}
                            className="rounded-xl border border-gray-200 bg-white p-6 space-y-5"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-base font-bold text-gray-800">{gateway.provider_name}</h2>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        Enter the merchant credentials from your own {gateway.provider_name} account.
                                    </p>
                                </div>
                                <span
                                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                                        verified
                                            ? 'bg-emerald-50 text-emerald-700'
                                            : 'bg-gray-100 text-gray-600'
                                    }`}
                                >
                                    {verified ? <CheckCircle className="w-3.5 h-3.5" /> : null}
                                    {verified ? 'Verified' : 'Not verified'}
                                </span>
                            </div>

                            {gateway.last_error && (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                    <span>{gateway.last_error}</span>
                                </div>
                            )}

                            <div className="space-y-3">
                                <label className="flex items-center gap-3 text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={draft.enabled}
                                        onChange={(event) =>
                                            updateDraft(gateway.provider_id, { enabled: event.target.checked })
                                        }
                                        className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                                    />
                                    Offer this at checkout
                                </label>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Mode</label>
                                    <select
                                        value={draft.mode}
                                        onChange={(event) =>
                                            updateDraft(gateway.provider_id, {
                                                mode: event.target.value as 'sandbox' | 'live',
                                            })
                                        }
                                        className={inputCls}
                                    >
                                        <option value="sandbox">Sandbox (testing)</option>
                                        <option value="live">Live</option>
                                    </select>
                                </div>

                                {gateway.credential_fields.map((field) => (
                                    <div key={field.key}>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">
                                            {field.label}
                                            {field.required ? <span className="text-red-500"> *</span> : null}
                                        </label>
                                        <input
                                            type={field.secret ? 'password' : 'text'}
                                            value={draft.credentials[field.key] ?? ''}
                                            placeholder={field.placeholder || ''}
                                            onChange={(event) =>
                                                updateCredential(gateway.provider_id, field.key, event.target.value)
                                            }
                                            autoComplete="off"
                                            className={inputCls}
                                        />
                                        {field.help && <p className="mt-1 text-xs text-gray-400">{field.help}</p>}
                                        {field.secret && (
                                            <p className="mt-1 text-xs text-gray-400">
                                                Leave unchanged to keep the saved value.
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                                <Button
                                    onClick={() => save(gateway.provider_id)}
                                    loading={saving === gateway.provider_id}
                                    size="md"
                                >
                                    Save
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => test(gateway.provider_id)}
                                    loading={testing === gateway.provider_id}
                                    size="md"
                                >
                                    Check details
                                </Button>
                            </div>
                        </section>
                    );
                })}
            </div>
        </PageShell>
    );
}
