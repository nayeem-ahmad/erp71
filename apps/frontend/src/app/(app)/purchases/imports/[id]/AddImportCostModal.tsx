'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n, formatMessage } from '@/lib/i18n';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Input, Select, Field, Button, Checkbox } from '@/components/ui';

/**
 * Kept in step with `IMPORT_COST_TYPES` and `CAPITALIZED_BY_DEFAULT` in the
 * backend. `recoverable` marks a charge the tenant gets back — rebatable VAT,
 * creditable AIT — or one that finances the import rather than costing the
 * goods, and the form says so, because the whole point of the flag is that the
 * person entering the charge understands why it is not in the product cost.
 */
const COST_TYPES: Array<{ value: string; recoverable?: boolean }> = [
    { value: 'FREIGHT' },
    { value: 'INSURANCE' },
    { value: 'CUSTOMS_DUTY' },
    { value: 'RD' },
    { value: 'SD' },
    { value: 'VAT', recoverable: true },
    { value: 'AIT', recoverable: true },
    { value: 'CF_AGENT' },
    { value: 'PORT' },
    { value: 'TRANSPORT' },
    { value: 'LC_MARGIN', recoverable: true },
    { value: 'LC_COMMISSION', recoverable: true },
    { value: 'BANK_CHARGE', recoverable: true },
    { value: 'OTHER' },
];

const BASES = ['VALUE', 'QTY', 'WEIGHT', 'CBM'] as const;

/** The currencies the new-shipment form offers, so a charge can match its invoice. */
const CURRENCIES = ['BDT', 'USD', 'EUR', 'CNY', 'GBP', 'JPY', 'INR', 'AED', 'SGD'];

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
    const copy = t.imports.cost;

    const [costType, setCostType] = useState('CUSTOMS_DUTY');
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [basis, setBasis] = useState('');
    const [currency, setCurrency] = useState('BDT');
    const [fxRate, setFxRate] = useState('');
    const [accounts, setAccounts] = useState<any[]>([]);
    const [paidFromAccountId, setPaidFromAccountId] = useState('');
    const [paidAt, setPaidAt] = useState('');
    const [capitalizeOverride, setCapitalizeOverride] = useState(false);
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

    // Switching to a charge that is part of the goods' cost by default clears
    // the override, so a tick left on VAT cannot follow the user onto freight.
    useEffect(() => {
        if (!selected?.recoverable) setCapitalizeOverride(false);
    }, [selected?.recoverable]);

    const submit = async () => {
        if (!Number(amount)) {
            toast.error(copy.amountRequired);
            return;
        }
        if (currency !== 'BDT' && !Number(fxRate)) {
            toast.error(formatMessage(copy.rateRequired, { currency }));
            return;
        }

        setSaving(true);
        try {
            await api.addImportCost(shipmentId, {
                costType,
                amount: Number(amount),
                currency,
                fxRate: currency === 'BDT' ? undefined : Number(fxRate),
                description: description || undefined,
                allocationBasis: basis || undefined,
                paidFromAccountId: paidFromAccountId || undefined,
                paidAt: paidAt || undefined,
                // Only ever sent as an override on a charge that would default
                // the other way; the backend owns the default itself.
                isCapitalized: selected?.recoverable && capitalizeOverride ? true : undefined,
            });
            toast.success(copy.saved);
            onSaved();
        } catch (error: any) {
            toast.error(error.message || copy.failed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={t.imports.detail.addCost} onClose={onClose} />

            <div className="space-y-3 overflow-y-auto p-4">
                <Field label={copy.costType} htmlFor="cost-type">
                    <Select id="cost-type" value={costType} onChange={(e) => setCostType(e.target.value)}>
                        {COST_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                                {t.imports.costTypes[type.value as keyof typeof t.imports.costTypes]}
                            </option>
                        ))}
                    </Select>
                </Field>

                {selected?.recoverable && (
                    <>
                        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                            {copy.notCapitalized}
                        </p>
                        <label className="flex items-start gap-2 text-sm text-gray-700">
                            <Checkbox
                                checked={capitalizeOverride}
                                onChange={() => setCapitalizeOverride((value) => !value)}
                            />
                            <span>
                                {copy.capitalizeOverride}
                                <span className="block text-xs text-gray-500">{copy.capitalizeOverrideHint}</span>
                            </span>
                        </label>
                    </>
                )}

                <div className="grid grid-cols-2 gap-3">
                    <Field label={t.common.amount} htmlFor="cost-amount">
                        <Input
                            id="cost-amount"
                            type="number"
                            min="0"
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                        />
                    </Field>

                    <Field label={copy.currency} htmlFor="cost-currency">
                        <Select id="cost-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                            {CURRENCIES.map((code) => (
                                <option key={code} value={code}>
                                    {code}
                                </option>
                            ))}
                        </Select>
                    </Field>
                </div>

                {/* Only asked for on a foreign-currency charge — a freight or
                    insurance invoice can be billed in USD even when the duty
                    beside it is not. */}
                {currency !== 'BDT' && (
                    <Field label={formatMessage(copy.fxRate, { currency })} htmlFor="cost-fx">
                        <Input
                            id="cost-fx"
                            type="number"
                            min="0"
                            step="0.000001"
                            value={fxRate}
                            onChange={(e) => setFxRate(e.target.value)}
                        />
                    </Field>
                )}

                <Field label={t.common.description} htmlFor="cost-description">
                    <Input
                        id="cost-description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </Field>

                <Field label={copy.allocate} hint={copy.allocateHint} htmlFor="cost-basis">
                    <Select id="cost-basis" value={basis} onChange={(e) => setBasis(e.target.value)}>
                        <option value="">{copy.default}</option>
                        {BASES.map((option) => (
                            <option key={option} value={option}>
                                {t.imports.bases[option]}
                            </option>
                        ))}
                    </Select>
                </Field>

                <Field label={copy.paidFrom} hint={copy.paidFromHint} htmlFor="cost-account">
                    <Select
                        id="cost-account"
                        value={paidFromAccountId}
                        onChange={(e) => setPaidFromAccountId(e.target.value)}
                    >
                        <option value="">{copy.notPaidYet}</option>
                        {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                                {account.name}
                            </option>
                        ))}
                    </Select>
                </Field>

                {/* The duty report is dated on this, not on when the charge was
                    typed in — without the field a duty payment keyed a week
                    late landed in the wrong VAT month. */}
                {paidFromAccountId && (
                    <Field label={copy.paidOn} hint={copy.paidOnHint} htmlFor="cost-paid-at">
                        <Input
                            id="cost-paid-at"
                            type="date"
                            value={paidAt}
                            onChange={(e) => setPaidAt(e.target.value)}
                        />
                    </Field>
                )}
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
