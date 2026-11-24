'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type {
    PaymentProviderCredentialField,
    StorefrontPaymentProviderSummary,
} from '@erp71/shared-types';
import { Button } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import { fetchWithAuth } from '@/lib/api';
import { toast } from '@/lib/toast';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';

const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';

const SSLCOMMERZ_FIELDS: PaymentProviderCredentialField[] = [
    { key: 'store_id', label: 'Store ID', required: true },
    { key: 'store_password', label: 'Store Password', secret: true, required: true },
];

type Draft = {
    code: string;
    name: string;
    description: string;
    adapter: 'SSLCOMMERZ' | 'HOSTED_REDIRECT';
    currency: string;
    sort_order: string;
    is_active: boolean;
    credential_fields: string;
    config: string;
};

const EMPTY_DRAFT: Draft = {
    code: '',
    name: '',
    description: '',
    adapter: 'HOSTED_REDIRECT',
    currency: 'BDT',
    sort_order: '10',
    is_active: true,
    credential_fields: JSON.stringify(SSLCOMMERZ_FIELDS, null, 2),
    config: JSON.stringify({ initiate_url: '', validation_url: '', field_map: {} }, null, 2),
};

function toDraft(provider: StorefrontPaymentProviderSummary): Draft {
    return {
        code: provider.code,
        name: provider.name,
        description: provider.description ?? '',
        adapter: provider.adapter,
        currency: provider.currency,
        sort_order: String(provider.sort_order),
        is_active: provider.is_active,
        credential_fields: JSON.stringify(provider.credential_fields, null, 2),
        config: JSON.stringify(provider.config ?? {}, null, 2),
    };
}

function parseJson(value: string, label: string): unknown {
    try {
        return JSON.parse(value || '{}');
    } catch {
        throw new Error(`${label} is not valid JSON.`);
    }
}

export default function StorefrontPaymentProvidersPage() {
    const [providers, setProviders] = useState<StorefrontPaymentProviderSummary[] | null>(null);
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [createOpen, setCreateOpen] = useState(false);
    const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
    const [saving, setSaving] = useState<string | null>(null);

    const load = async () => {
        const data: StorefrontPaymentProviderSummary[] = await fetchWithAuth('/admin/storefront-payment-providers');
        setProviders(data);
        setDrafts(Object.fromEntries(data.map((provider) => [provider.id, toDraft(provider)])));
    };

    useEffect(() => {
        load().catch((error) => toast.error(error?.message || 'Could not load payment providers.'));
    }, []);

    const updateDraft = (id: string, patch: Partial<Draft>) =>
        setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

    const save = async (id: string) => {
        const draft = drafts[id];
        setSaving(id);
        try {
            const payload = {
                code: draft.code,
                name: draft.name,
                description: draft.description || undefined,
                adapter: draft.adapter,
                currency: draft.currency,
                sort_order: Number(draft.sort_order) || 0,
                is_active: draft.is_active,
                credential_fields: parseJson(draft.credential_fields, 'Credential fields'),
                config: parseJson(draft.config, 'Configuration'),
            };
            await fetchWithAuth(`/admin/storefront-payment-providers/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            await load();
            toast.success('Provider saved.');
        } catch (error: any) {
            toast.error(error?.message || 'Could not save the provider.');
        } finally {
            setSaving(null);
        }
    };

    const remove = async (id: string) => {
        if (!globalThis.confirm('Delete this provider? Shops configured with it will lose their account details.')) {
            return;
        }
        try {
            await fetchWithAuth(`/admin/storefront-payment-providers/${id}`, { method: 'DELETE' });
            await load();
            toast.success('Provider removed.');
        } catch (error: any) {
            toast.error(error?.message || 'Could not delete the provider.');
        }
    };

    const create = async () => {
        setSaving('new');
        try {
            const payload = {
                code: newDraft.code,
                name: newDraft.name,
                description: newDraft.description || undefined,
                adapter: newDraft.adapter,
                currency: newDraft.currency,
                sort_order: Number(newDraft.sort_order) || 0,
                is_active: newDraft.is_active,
                credential_fields: parseJson(newDraft.credential_fields, 'Credential fields'),
                config: parseJson(newDraft.config, 'Configuration'),
            };
            await fetchWithAuth('/admin/storefront-payment-providers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            setNewDraft(EMPTY_DRAFT);
            setCreateOpen(false);
            await load();
            toast.success('Provider added.');
        } catch (error: any) {
            toast.error(error?.message || 'Could not add the provider.');
        } finally {
            setSaving(null);
        }
    };

    const restoreDefaults = async () => {
        try {
            await fetchWithAuth('/admin/storefront-payment-providers/restore-defaults', { method: 'POST' });
            await load();
            toast.success('Default providers restored.');
        } catch (error: any) {
            toast.error(error?.message || 'Could not restore defaults.');
        }
    };

    return (
        <PageShell maxWidth="wide">
            <PageHeader
                title="Storefront payment providers"
                subtitle="The gateways shops can connect their own merchant accounts to. Adding one here adds it to every shop's payment settings — no deploy needed for a hosted-redirect gateway."
                breadcrumbs={nestedPageBreadcrumbs(
                    'Home',
                    'Admin',
                    'admin',
                    [
                        { label: 'Platform settings', href: routes.admin.platformSettings.root },
                        { label: 'Payments', href: routes.admin.platformSettings.payments },
                    ],
                    'Storefront providers',
                )}
                actions={
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" size="md" icon={<RotateCcw className="w-4 h-4" />} onClick={restoreDefaults}>
                            Restore defaults
                        </Button>
                        <Button size="md" icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen((open) => !open)}>
                            New provider
                        </Button>
                    </div>
                }
            />

            {createOpen && (
                <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
                    <h2 className="text-base font-bold text-gray-800">New provider</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Code</label>
                            <input
                                value={newDraft.code}
                                onChange={(event) => setNewDraft({ ...newDraft, code: event.target.value })}
                                placeholder="e.g. sslcommerz"
                                className={inputCls}
                            />
                            <p className="mt-1 text-xs text-gray-400">Stable id stored on orders. Lower-case, no spaces.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                            <input
                                value={newDraft.name}
                                onChange={(event) => setNewDraft({ ...newDraft, name: event.target.value })}
                                placeholder="e.g. SSLCommerz"
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Adapter</label>
                            <select
                                value={newDraft.adapter}
                                onChange={(event) =>
                                    setNewDraft({ ...newDraft, adapter: event.target.value as Draft['adapter'] })
                                }
                                className={inputCls}
                            >
                                <option value="HOSTED_REDIRECT">Hosted redirect (configured by JSON)</option>
                                <option value="SSLCOMMERZ">SSLCommerz</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Currency</label>
                            <input
                                value={newDraft.currency}
                                onChange={(event) => setNewDraft({ ...newDraft, currency: event.target.value })}
                                className={inputCls}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                            <input
                                value={newDraft.description}
                                onChange={(event) => setNewDraft({ ...newDraft, description: event.target.value })}
                                className={inputCls}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Credential fields (JSON)</label>
                            <textarea
                                rows={6}
                                value={newDraft.credential_fields}
                                onChange={(event) => setNewDraft({ ...newDraft, credential_fields: event.target.value })}
                                className={`${inputCls} font-mono text-xs`}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Configuration (JSON)</label>
                            <textarea
                                rows={8}
                                value={newDraft.config}
                                onChange={(event) => setNewDraft({ ...newDraft, config: event.target.value })}
                                className={`${inputCls} font-mono text-xs`}
                            />
                            <p className="mt-1 text-xs text-gray-400">
                                Hosted redirect needs <code>initiate_url</code>, <code>validation_url</code> and{' '}
                                <code>field_map</code>. Templates support {'{amount}'}, {'{currency}'}, {'{orderId}'},{' '}
                                {'{orderRef}'}, {'{paymentId}'}, {'{customerName}'}, {'{customerEmail}'},{' '}
                                {'{customerPhone}'}, {'{successUrl}'}, {'{failUrl}'} and {'{cancelUrl}'}.
                            </p>
                        </div>
                    </div>
                    <Button size="md" onClick={create} loading={saving === 'new'}>
                        Add provider
                    </Button>
                </section>
            )}

            {!providers && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading providers…
                </div>
            )}

            <div className="space-y-4">
                {(providers ?? []).map((provider) => {
                    const draft = drafts[provider.id];
                    if (!draft) return null;
                    return (
                        <section key={provider.id} className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h2 className="text-base font-bold text-gray-800">
                                        {provider.name}{' '}
                                        <span className="text-xs font-normal text-gray-400">({provider.code})</span>
                                    </h2>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        Adapter: {provider.adapter} · {provider.currency} · sort {provider.sort_order}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={draft.is_active}
                                            onChange={(event) => updateDraft(provider.id, { is_active: event.target.checked })}
                                            className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                                        />
                                        Active
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => remove(provider.id)}
                                        className="p-1.5 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                                        aria-label={`Delete ${provider.name}`}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                                    <input
                                        value={draft.name}
                                        onChange={(event) => updateDraft(provider.id, { name: event.target.value })}
                                        className={inputCls}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Code</label>
                                    <input
                                        value={draft.code}
                                        onChange={(event) => updateDraft(provider.id, { code: event.target.value })}
                                        className={inputCls}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Adapter</label>
                                    <select
                                        value={draft.adapter}
                                        onChange={(event) =>
                                            updateDraft(provider.id, { adapter: event.target.value as Draft['adapter'] })
                                        }
                                        className={inputCls}
                                    >
                                        <option value="HOSTED_REDIRECT">Hosted redirect</option>
                                        <option value="SSLCOMMERZ">SSLCommerz</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Sort order</label>
                                    <input
                                        type="number"
                                        value={draft.sort_order}
                                        onChange={(event) => updateDraft(provider.id, { sort_order: event.target.value })}
                                        className={inputCls}
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                                    <input
                                        value={draft.description}
                                        onChange={(event) => updateDraft(provider.id, { description: event.target.value })}
                                        className={inputCls}
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                        Credential fields (JSON)
                                    </label>
                                    <textarea
                                        rows={6}
                                        value={draft.credential_fields}
                                        onChange={(event) =>
                                            updateDraft(provider.id, { credential_fields: event.target.value })
                                        }
                                        className={`${inputCls} font-mono text-xs`}
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                        Configuration (JSON)
                                    </label>
                                    <textarea
                                        rows={8}
                                        value={draft.config}
                                        onChange={(event) => updateDraft(provider.id, { config: event.target.value })}
                                        className={`${inputCls} font-mono text-xs`}
                                    />
                                </div>
                            </div>

                            <Button size="md" onClick={() => save(provider.id)} loading={saving === provider.id}>
                                Save
                            </Button>
                        </section>
                    );
                })}
            </div>
        </PageShell>
    );
}
