'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Input, Select, Field, Button } from '@/components/ui';

/**
 * Paying a charge that was recorded before the money left.
 *
 * Reachable after receipt, where editing a cost is not — the landed cost is
 * already fixed and only the cash leg is outstanding. Without it the C&F
 * agent's bill, which routinely arrives weeks after the goods, had no way of
 * ever being settled.
 */
export default function PayCostModal({
    shipmentId,
    cost,
    onClose,
    onPaid,
}: {
    shipmentId: string;
    cost: any;
    onClose: () => void;
    onPaid: () => void;
}) {
    const { t, locale } = useI18n();
    const copy = t.imports.cost;

    const [paidFromAccountId, setPaidFromAccountId] = useState('');
    const [paidAt, setPaidAt] = useState('');
    const [accounts, setAccounts] = useState<any[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getAccounts()
            .then((rows: any[]) =>
                setAccounts((rows ?? []).filter((row) => row.category === 'cash' || row.category === 'bank')),
            )
            .catch(() => {});
    }, []);

    const submit = async () => {
        if (!paidFromAccountId) {
            toast.error(copy.paidFrom);
            return;
        }

        setSaving(true);
        try {
            await api.payImportCost(shipmentId, cost.id, {
                paidFromAccountId,
                paidAt: paidAt || undefined,
            });
            toast.success(copy.paidToast);
            onPaid();
        } catch (error: any) {
            toast.error(error.message || copy.failed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={copy.payTitle} onClose={onClose} />

            <div className="space-y-3 overflow-y-auto p-4">
                <p className="text-xs text-gray-500">{copy.payExplainer}</p>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-500">
                            {t.imports.costTypes[cost.cost_type as keyof typeof t.imports.costTypes] ?? cost.cost_type}
                        </span>
                        <span className="font-semibold text-gray-900">
                            {formatBDT(Number(cost.amount_bdt), { locale })}
                        </span>
                    </div>
                    {cost.description && <p className="mt-1 text-xs text-gray-500">{cost.description}</p>}
                </div>

                <Field label={copy.paidFrom} htmlFor="pay-account">
                    <Select
                        id="pay-account"
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

                <Field label={copy.paidOn} hint={copy.paidOnHint} htmlFor="pay-date">
                    <Input id="pay-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
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
