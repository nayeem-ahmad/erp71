'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n, formatMessage } from '@/lib/i18n';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Input, Select, Field, Button, Alert } from '@/components/ui';

/**
 * Settling the LC with the bank.
 *
 * The endpoint has existed since Phase 5 and nothing called it, so a usance LC
 * could never be closed and the realised FX gain or loss the whole of §4.6
 * exists for was never recognised.
 *
 * The gain/loss preview is computed here rather than fetched: it is the one
 * number the person typing the rate is actually deciding about, and showing it
 * before they commit is the difference between entering a rate and understanding
 * what it does.
 */
export default function SettleLcModal({
    shipment,
    onClose,
    onSettled,
}: {
    shipment: any;
    onClose: () => void;
    onSettled: () => void;
}) {
    const { t, locale } = useI18n();
    const copy = t.imports.settle;

    const [rate, setRate] = useState('');
    const [paidFromAccountId, setPaidFromAccountId] = useState('');
    const [settledAt, setSettledAt] = useState('');
    const [accounts, setAccounts] = useState<any[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        // Cash and bank only, for the same reason the add-cost modal filters:
        // offering the whole chart invites settling an LC to Sales Revenue.
        api.getAccounts()
            .then((rows: any[]) =>
                setAccounts((rows ?? []).filter((row) => row.category === 'cash' || row.category === 'bank')),
            )
            .catch(() => {});
    }, []);

    const openRate = Number(shipment.fx_rate_at_open ?? 0) || (shipment.currency === 'BDT' ? 1 : 0);
    const invoiceFc = Number(shipment.invoice_value_fc ?? 0);

    const preview = useMemo(() => {
        const settleRate = Number(rate);
        if (!settleRate || !openRate) return null;
        const booked = Math.round(invoiceFc * openRate * 100) / 100;
        const settled = Math.round(invoiceFc * settleRate * 100) / 100;
        // Positive = the liability cost less than it was booked at, so a gain.
        return { booked, settled, difference: Math.round((booked - settled) * 100) / 100 };
    }, [rate, openRate, invoiceFc]);

    const submit = async () => {
        if (!Number(rate)) {
            toast.error(formatMessage(t.imports.cost.rateRequired, { currency: shipment.currency }));
            return;
        }
        if (!paidFromAccountId) {
            toast.error(copy.paidFrom);
            return;
        }

        setSaving(true);
        try {
            const result = await api.settleImportShipment(shipment.id, {
                fxRateAtSettle: Number(rate),
                paidFromAccountId,
                settledAt: settledAt || undefined,
            });
            toast.success(copy.done);
            if (result?.acceptance_voucher_number) {
                // Settling accepts on the caller's behalf when nobody did, and
                // that posts a second voucher they did not ask for by name.
                toast.success(t.imports.accept.done);
            }
            onSettled();
        } catch (error: any) {
            toast.error(error.message || copy.failed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={copy.title} onClose={onClose} />

            <div className="space-y-3 overflow-y-auto p-4">
                <p className="text-xs text-gray-500">{copy.explainer}</p>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-500">{t.imports.columns.invoiceValue}</span>
                        <span className="font-semibold text-gray-900">
                            {invoiceFc.toLocaleString(locale)} {shipment.currency}
                        </span>
                    </div>
                    <div className="mt-1 flex justify-between">
                        <span className="text-gray-500">{formatMessage(copy.bookedAt, { rate: openRate })}</span>
                        <span className="text-gray-700">{formatBDT(invoiceFc * openRate, { locale })}</span>
                    </div>
                </div>

                <Field label={copy.rateAtSettle} htmlFor="settle-rate">
                    <Input
                        id="settle-rate"
                        type="number"
                        min="0"
                        step="0.000001"
                        value={rate}
                        onChange={(e) => setRate(e.target.value)}
                    />
                </Field>

                {preview && preview.difference !== 0 && (
                    <Alert tone={preview.difference > 0 ? 'success' : 'warning'}>
                        {preview.difference > 0 ? copy.projectedGain : copy.projectedLoss}:{' '}
                        <span className="font-semibold">
                            {formatBDT(Math.abs(preview.difference), { locale })}
                        </span>
                    </Alert>
                )}

                <Field label={copy.paidFrom} htmlFor="settle-account">
                    <Select
                        id="settle-account"
                        value={paidFromAccountId}
                        onChange={(e) => setPaidFromAccountId(e.target.value)}
                    >
                        <option value="">—</option>
                        {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                                {account.name}
                            </option>
                        ))}
                    </Select>
                </Field>

                <Field label={copy.settledAt} htmlFor="settle-date">
                    <Input
                        id="settle-date"
                        type="date"
                        value={settledAt}
                        onChange={(e) => setSettledAt(e.target.value)}
                    />
                </Field>
            </div>

            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button onClick={submit} disabled={saving}>
                    {t.common.save}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
