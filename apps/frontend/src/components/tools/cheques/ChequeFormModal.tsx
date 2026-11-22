'use client';

import { useMemo, useState } from 'react';
import { CHEQUE_STATUSES, type ChequeDirection, type ChequeStatus } from '@erp71/shared-types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox, Field, FormGrid, Input, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { takaInWords } from '@/lib/amount-in-words';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { todayLocal } from '../dates';
import type { Cheque, ChequeInput } from '../types';

type Errors = Partial<Record<'partyName' | 'amount' | 'chequeDate' | 'chequeNumber' | 'bankName', string>>;

/** New or edit. Saves through the API and hands the stored row back. */
export function ChequeFormModal({
    cheque,
    onClose,
    onSaved,
}: {
    cheque: Cheque | null;
    onClose: () => void;
    onSaved: (cheque: Cheque) => void;
}) {
    const { t } = useI18n();
    const m = t.tools.cheques;
    const f = m.form;

    const [direction, setDirection] = useState<ChequeDirection>(cheque?.direction ?? 'ISSUED');
    const [partyName, setPartyName] = useState(cheque?.party_name ?? '');
    const [amount, setAmount] = useState(cheque ? String(cheque.amount) : '');
    const [chequeDate, setChequeDate] = useState(cheque?.cheque_date ?? todayLocal());
    const [chequeNumber, setChequeNumber] = useState(cheque?.cheque_number ?? '');
    const [bankName, setBankName] = useState(cheque?.bank_name ?? '');
    const [branchName, setBranchName] = useState(cheque?.branch_name ?? '');
    const [accountNumber, setAccountNumber] = useState(cheque?.account_number ?? '');
    const [accountPayee, setAccountPayee] = useState(cheque?.account_payee ?? true);
    const [memo, setMemo] = useState(cheque?.memo ?? '');
    const [status, setStatus] = useState<ChequeStatus>(cheque?.status ?? 'PENDING');
    const [errors, setErrors] = useState<Errors>({});
    const [saving, setSaving] = useState(false);

    const amountNumber = Number(amount);
    const words = useMemo(
        () => (Number.isFinite(amountNumber) && amountNumber > 0 ? takaInWords(amountNumber) : ''),
        [amountNumber],
    );

    const validate = (): Errors => {
        const next: Errors = {};
        if (!partyName.trim()) next.partyName = f.required;
        if (!Number.isFinite(amountNumber) || amountNumber <= 0) next.amount = f.amountInvalid;
        if (!chequeDate) next.chequeDate = f.required;
        if (!chequeNumber.trim()) next.chequeNumber = f.required;
        if (!bankName.trim()) next.bankName = f.required;
        return next;
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const next = validate();
        setErrors(next);
        if (Object.keys(next).length) return;

        const body: ChequeInput = {
            direction,
            partyName: partyName.trim(),
            amount: Math.round(amountNumber * 100) / 100,
            chequeDate,
            chequeNumber: chequeNumber.trim(),
            bankName: bankName.trim(),
            branchName: branchName.trim(),
            accountNumber: accountNumber.trim(),
            accountPayee,
            memo: memo.trim(),
            status,
        };
        setSaving(true);
        try {
            const saved = cheque ? await api.updateCheque(cheque.id, body) : await api.createCheque(body);
            toast.success(m.saved);
            onSaved(saved);
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose} dismissOnBackdrop={false}>
            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
                <ModalHeader title={cheque ? m.editCheque : m.newCheque} onClose={onClose} />
                <div className="space-y-3 overflow-y-auto p-4">
                    <fieldset>
                        <legend className="text-xs font-medium text-gray-600">{f.direction}</legend>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                            {(['ISSUED', 'RECEIVED'] as const).map((value) => (
                                <label
                                    key={value}
                                    className={`flex min-h-touch cursor-pointer flex-col rounded-md border px-3 py-2 text-sm ${
                                        direction === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white'
                                    }`}
                                >
                                    <span className="flex items-center gap-2 font-medium text-gray-900">
                                        <input
                                            type="radio"
                                            name="cheque-direction"
                                            value={value}
                                            checked={direction === value}
                                            onChange={() => setDirection(value)}
                                            className="accent-blue-600"
                                        />
                                        {m.direction[value]}
                                    </span>
                                    <span className="text-xs text-gray-500">{value === 'ISSUED' ? f.issuedHint : f.receivedHint}</span>
                                </label>
                            ))}
                        </div>
                    </fieldset>

                    <FormGrid>
                        <Field label={direction === 'ISSUED' ? f.payee : f.drawer} required error={errors.partyName} htmlFor="cheque-party">
                            <Input id="cheque-party" value={partyName} onChange={(e) => setPartyName(e.target.value)} maxLength={200} error={!!errors.partyName} className="w-full" />
                        </Field>
                        <Field label={f.amount} required error={errors.amount} htmlFor="cheque-amount">
                            <Input
                                id="cheque-amount"
                                type="number"
                                inputMode="decimal"
                                min="0.01"
                                step="0.01"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                error={!!errors.amount}
                                className="w-full"
                            />
                        </Field>
                    </FormGrid>
                    {words && (
                        <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">
                            <span className="font-medium text-gray-500">{f.amountInWords}: </span>
                            {words}
                        </p>
                    )}

                    <FormGrid>
                        <Field label={f.chequeDate} required error={errors.chequeDate} hint={f.chequeDateHint} htmlFor="cheque-date">
                            <Input id="cheque-date" type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} error={!!errors.chequeDate} className="w-full" />
                        </Field>
                        <Field label={f.chequeNumber} required error={errors.chequeNumber} htmlFor="cheque-number">
                            <Input id="cheque-number" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} maxLength={40} inputMode="numeric" error={!!errors.chequeNumber} className="w-full" />
                        </Field>
                        <Field label={f.bankName} required error={errors.bankName} htmlFor="cheque-bank">
                            <Input id="cheque-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder={f.bankPlaceholder} maxLength={120} error={!!errors.bankName} className="w-full" />
                        </Field>
                        <Field label={f.branchName} htmlFor="cheque-branch">
                            <Input id="cheque-branch" value={branchName} onChange={(e) => setBranchName(e.target.value)} maxLength={120} className="w-full" />
                        </Field>
                        <Field label={f.accountNumber} htmlFor="cheque-account">
                            <Input id="cheque-account" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} maxLength={40} className="w-full" />
                        </Field>
                        {cheque && (
                            <Field label={f.status} htmlFor="cheque-status">
                                <Select id="cheque-status" value={status} onChange={(e) => setStatus(e.target.value as ChequeStatus)} className="w-full">
                                    {CHEQUE_STATUSES.map((value) => (
                                        <option key={value} value={value}>
                                            {m.status[value]}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        )}
                    </FormGrid>

                    <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                        <Checkbox checked={accountPayee} onChange={(e) => setAccountPayee(e.target.checked)} />
                        {f.accountPayee}
                    </label>

                    <Field label={f.memo} htmlFor="cheque-memo">
                        <Textarea id="cheque-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={f.memoPlaceholder} maxLength={500} rows={2} className="w-full" />
                    </Field>
                </div>
                <ModalFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>
                        {t.common.cancel}
                    </Button>
                    <Button type="submit" loading={saving} disabled={saving}>
                        {saving ? f.saving : f.save}
                    </Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}
