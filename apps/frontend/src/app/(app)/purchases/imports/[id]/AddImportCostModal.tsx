'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Input, Select, Field, Button } from '@/components/ui';

/**
 * Kept in step with `IMPORT_COST_TYPES` and `CAPITALIZED_BY_DEFAULT` in the
 * backend. `recoverable` marks a charge the tenant gets back — rebatable VAT,
 * creditable AIT — or one that finances the import rather than costing the
 * goods, and the form says so, because the whole point of the flag is that the
 * person entering the charge understands why it is not in the product cost.
 */
const COST_TYPES: Array<{ value: string; label: string; recoverable?: boolean }> = [
    { value: 'FREIGHT', label: 'Freight' },
    { value: 'INSURANCE', label: 'Insurance' },
    { value: 'CUSTOMS_DUTY', label: 'Customs duty' },
    { value: 'RD', label: 'Regulatory duty (RD)' },
    { value: 'SD', label: 'Supplementary duty (SD)' },
    { value: 'VAT', label: 'VAT', recoverable: true },
    { value: 'AIT', label: 'Advance income tax (AIT)', recoverable: true },
    { value: 'CF_AGENT', label: 'C&F agent' },
    { value: 'PORT', label: 'Port charges' },
    { value: 'TRANSPORT', label: 'Inland transport' },
    { value: 'LC_MARGIN', label: 'LC margin', recoverable: true },
    { value: 'LC_COMMISSION', label: 'LC commission', recoverable: true },
    { value: 'BANK_CHARGE', label: 'Bank charge', recoverable: true },
    { value: 'OTHER', label: 'Other' },
];

const BASES = [
    { value: 'VALUE', label: 'By value' },
    { value: 'QTY', label: 'By quantity' },
    { value: 'WEIGHT', label: 'By weight' },
    { value: 'CBM', label: 'By volume (CBM)' },
];

export default function AddImportCostModal({
    shipmentId,
    onClose,
    onSaved,
}: {
    shipmentId: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useI18n();
    const [costType, setCostType] = useState('CUSTOMS_DUTY');
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [basis, setBasis] = useState('');
    const [accounts, setAccounts] = useState<any[]>([]);
    const [paidFromAccountId, setPaidFromAccountId] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        // Cash and bank accounts only: a charge is paid from somewhere real,
        // and offering the whole chart invites posting a duty payment to
        // Sales Revenue.
        api.getAccounts()
            .then((rows: any[]) =>
                setAccounts((rows ?? []).filter((row) => row.category === 'cash' || row.category === 'bank')),
            )
            .catch(() => {});
    }, []);

    const selected = COST_TYPES.find((type) => type.value === costType);

    const submit = async () => {
        if (!Number(amount)) {
            toast.error('Enter an amount');
            return;
        }

        setSaving(true);
        try {
            await api.addImportCost(shipmentId, {
                costType,
                amount: Number(amount),
                description: description || undefined,
                allocationBasis: basis || undefined,
                paidFromAccountId: paidFromAccountId || undefined,
            });
            toast.success('Cost recorded');
            onSaved();
        } catch (error: any) {
            toast.error(error.message || 'Could not record the cost');
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={t.imports.detail.addCost} onClose={onClose} />

            <div className="space-y-3 overflow-y-auto p-4">
                <Field label="Cost type">
                    <Select value={costType} onChange={(e) => setCostType(e.target.value)}>
                        {COST_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                                {type.label}
                            </option>
                        ))}
                    </Select>
                </Field>

                {selected?.recoverable && (
                    <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                        This charge is not part of the product cost — it is recoverable or a financing cost, so it
                        posts to its own account and never reaches inventory.
                    </p>
                )}

                <Field label={t.common.amount}>
                    <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>

                <Field label={t.common.description}>
                    <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </Field>

                <Field label="Allocate" hint="Leave blank to use the default for this cost type.">
                    <Select value={basis} onChange={(e) => setBasis(e.target.value)}>
                        <option value="">Default</option>
                        {BASES.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                </Field>

                <Field
                    label="Paid from"
                    hint="Leave blank to record the charge as accrued. It still counts toward the landed cost."
                >
                    <Select value={paidFromAccountId} onChange={(e) => setPaidFromAccountId(e.target.value)}>
                        <option value="">Not paid yet</option>
                        {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                                {account.name}
                            </option>
                        ))}
                    </Select>
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
