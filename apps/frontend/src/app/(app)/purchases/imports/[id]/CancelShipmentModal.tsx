'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n, formatMessage } from '@/lib/i18n';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Input, Field, Button, Alert } from '@/components/ui';

/**
 * Abandoning a shipment, with a reason.
 *
 * A modal rather than a `ConfirmDialog` because the reason is the point: the
 * backend appends it to the shipment's notes, which is the audit trail that
 * justifies writing freight and duty off to expense. A plain confirm would
 * write off the money and record nothing about why.
 */
export default function CancelShipmentModal({
    shipment,
    onClose,
    onCancelled,
}: {
    shipment: any;
    onClose: () => void;
    onCancelled: () => void;
}) {
    const { t, locale } = useI18n();
    const copy = t.imports.detail;

    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    // Only charges that actually reached Goods in Transit are written off, and
    // this mirrors what the service will do so the figure is not a surprise.
    const atRisk =
        Math.round(
            (shipment.costs ?? [])
                .filter((cost: any) => cost.is_capitalized && cost.voucher_id)
                .reduce((sum: number, cost: any) => sum + Number(cost.amount_bdt), 0) * 100,
        ) / 100;

    const submit = async () => {
        setSaving(true);
        try {
            const result = await api.cancelImportShipment(shipment.id, { reason: reason || undefined });
            toast.success(copy.cancelled);
            if (result?.written_off_bdt > 0) {
                toast.success(
                    formatMessage(copy.writtenOff, { amount: formatBDT(result.written_off_bdt, { locale }) }),
                );
            }
            onCancelled();
        } catch (error: any) {
            toast.error(error.message || copy.statusFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={copy.cancelTitle} onClose={onClose} />

            <div className="space-y-3 overflow-y-auto p-4">
                {copy.cancelPrompt.split('\n\n').map((paragraph) => (
                    <p key={paragraph} className="text-sm text-gray-600">
                        {paragraph}
                    </p>
                ))}

                {atRisk > 0 && (
                    <Alert tone="warning">
                        {formatMessage(copy.writtenOff, { amount: formatBDT(atRisk, { locale }) })}
                    </Alert>
                )}

                <Field label={copy.cancelReason} htmlFor="cancel-reason">
                    <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                </Field>
            </div>

            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button variant="danger" onClick={submit} disabled={saving}>
                    {copy.cancelShipment}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
