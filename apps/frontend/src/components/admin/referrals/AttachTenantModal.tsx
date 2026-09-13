'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { AttachableTenant } from './types';

type Props = {
    open: boolean;
    refereeId: string;
    refereeName: string;
    /** The partner's current terms, which prefill the two rate fields. */
    defaultDiscountPct: number;
    defaultCommissionPct: number;
    onClose: () => void;
    onSuccess: (message: string) => void;
};

/** Long enough that typing a business name is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Credits an existing business to a partner by hand.
 *
 * The referral code is typed at signup and nowhere else, so a business a partner
 * brought in that left the box empty can only be attributed here. The two rates
 * are editable because a retroactive attribution is usually negotiated: a
 * business that already paid list price gets no signup discount, so an admin
 * zeroes that field rather than promising a refund.
 */
export default function AttachTenantModal({
    open,
    refereeId,
    refereeName,
    defaultDiscountPct,
    defaultCommissionPct,
    onClose,
    onSuccess,
}: Props) {
    const { t, fmt } = useI18n();
    const m = t.admin.referrals.attach;

    const [search, setSearch] = useState('');
    const [tenants, setTenants] = useState<AttachableTenant[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedId, setSelectedId] = useState('');
    const [discountPct, setDiscountPct] = useState(String(defaultDiscountPct));
    const [commissionPct, setCommissionPct] = useState(String(defaultCommissionPct));
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(async (term: string) => {
        setLoading(true);
        try {
            const data = await api.getAdminAttachableTenants(term ? { search: term } : undefined);
            setTenants(Array.isArray(data) ? data : []);
            setError('');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [m.loadFailed]);

    useEffect(() => {
        if (!open) return;
        // Debounced so a typed name is one request rather than one per keystroke.
        // The first pass runs with an empty term, which lists the newest workspaces —
        // the ones an admin is most often attributing.
        const handle = setTimeout(() => void load(search.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [open, search, load]);

    const selected = useMemo(
        () => tenants.find((tenant) => tenant.id === selectedId) ?? null,
        [tenants, selectedId],
    );

    if (!open) return null;

    const handleSubmit = async () => {
        if (!selected) {
            setError(m.selectFirst);
            return;
        }

        const discount = Number(discountPct);
        const commission = Number(commissionPct);
        if (![discount, commission].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
            setError(m.ratesInvalid);
            return;
        }

        setSubmitting(true);
        setError('');
        try {
            await api.attachAdminRefereeTenant(refereeId, {
                tenant_id: selected.id,
                discount_pct: discount,
                commission_pct: commission,
            });
            onSuccess(fmt(m.success, { tenant: selected.name, referee: refereeName }));
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.failed);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={m.title} subtitle={m.subtitle} onClose={onClose} />

            <div className="space-y-4 overflow-y-auto p-4">
                {error && (
                    <div className="rounded-md border border-danger bg-danger-light px-3 py-2 text-sm font-semibold text-danger-text">
                        {error}
                    </div>
                )}

                <Field label={m.searchLabel} htmlFor="attach-tenant-search">
                    <div className="relative">
                        <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                        <Input
                            id="attach-tenant-search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={m.searchPlaceholder}
                            className="w-full ps-8"
                            autoFocus
                        />
                    </div>
                </Field>

                <div className="max-h-72 space-y-2 overflow-y-auto">
                    {loading && tenants.length === 0 ? (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                            <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                    ) : tenants.length === 0 ? (
                        <p className="py-8 text-center text-sm text-gray-500">{m.noResults}</p>
                    ) : (
                        tenants.map((tenant) => {
                            const taken = tenant.attached_to !== null;
                            const isSelected = tenant.id === selectedId;
                            return (
                                <button
                                    key={tenant.id}
                                    type="button"
                                    disabled={taken}
                                    onClick={() => setSelectedId(tenant.id)}
                                    className={`w-full rounded-md border px-3 py-2 text-start transition-colors max-md:min-h-touch ${
                                        taken
                                            ? 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-70'
                                            : isSelected
                                                ? 'border-primary bg-primary-light'
                                                : 'border-gray-200 bg-white hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="truncate text-sm font-semibold text-gray-900">{tenant.name}</span>
                                        <span className="flex-shrink-0 text-xs text-gray-500">
                                            {tenant.plan_name ?? tenant.plan_code ?? m.noPlan}
                                        </span>
                                    </div>
                                    <p className="truncate text-xs text-gray-500">
                                        {tenant.owner_email ?? m.ownerUnknown}
                                        {' · '}
                                        {fmt(m.signedUpOn, { date: formatDate(tenant.created_at) })}
                                    </p>
                                    {tenant.attached_to && (
                                        <p className="mt-1 text-xs font-semibold text-warning-text">
                                            {fmt(m.attachedTo, { name: tenant.attached_to.referee_name })}
                                        </p>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={m.discountLabel} hint={m.discountHint} htmlFor="attach-tenant-discount">
                        <Input
                            id="attach-tenant-discount"
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={discountPct}
                            onChange={(event) => setDiscountPct(event.target.value)}
                            className="w-full"
                        />
                    </Field>
                    <Field label={m.commissionLabel} hint={m.commissionHint} htmlFor="attach-tenant-commission">
                        <Input
                            id="attach-tenant-commission"
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={commissionPct}
                            onChange={(event) => setCommissionPct(event.target.value)}
                            className="w-full"
                        />
                    </Field>
                </div>

                <p className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    {m.pendingNote}
                </p>
            </div>

            <ModalFooter>
                <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>
                    {m.cancel}
                </Button>
                <Button
                    variant="primary"
                    size="md"
                    onClick={() => void handleSubmit()}
                    disabled={!selected || submitting}
                    loading={submitting}
                >
                    {submitting ? m.saving : m.confirm}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
