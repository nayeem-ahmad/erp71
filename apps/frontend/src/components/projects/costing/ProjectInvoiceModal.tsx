'use client';

import { useEffect, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Alert, Button, Checkbox, Field, Input, Select } from '@/components/ui';

export type InvoiceRequest =
    | { kind: 'MILESTONE'; milestoneId: string; label: string; amount: number }
    | { kind: 'HOURS'; upTo: string; label: string; amount: number }
    | { kind: 'AMOUNT' };

/**
 * Raise one invoice for the project — a credit sale to its customer, on the
 * service product invoices bill as.
 *
 * Amounts on a project (contract value, milestone, bill rate) are before VAT,
 * so by default the invoice adds the product's VAT on top; ticking "already
 * includes VAT" bills the figure as it stands.
 */
export default function ProjectInvoiceModal({
    projectId,
    request,
    defaultProductId,
    customerName,
    onClose,
    onSaved,
}: {
    projectId: string;
    request: InvoiceRequest;
    defaultProductId: string | null;
    customerName: string | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t, fmt } = useI18n();
    const f = t.projects.financials;
    const [products, setProducts] = useState<Array<{ id: string; name: string; vatRate: number | null }>>([]);
    const [productId, setProductId] = useState(defaultProductId ?? '');
    const [amount, setAmount] = useState(request.kind === 'AMOUNT' ? '' : String(request.amount));
    const [description, setDescription] = useState('');
    const [includesVat, setIncludesVat] = useState(false);
    const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getProjectBillingProducts()
            .then((rows) => {
                setProducts(rows ?? []);
                if (!defaultProductId && rows?.length === 1) setProductId(rows[0].id);
            })
            .catch(() => setProducts([]));
    }, [defaultProductId]);

    const amountValue = Number(amount);
    const valid = Boolean(productId) && amountValue > 0 && (request.kind !== 'AMOUNT' || description.trim().length > 0);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        try {
            const result = await api.createProjectInvoice(projectId, {
                kind: request.kind,
                ...(request.kind === 'MILESTONE' ? { milestoneId: request.milestoneId } : {}),
                ...(request.kind === 'HOURS' ? { upTo: request.upTo } : {}),
                ...(request.kind === 'AMOUNT' ? { amount: amountValue, description: description.trim() } : {}),
                productId,
                amountIncludesVat: includesVat,
                saleDate,
            });
            toast.success(fmt(f.invoiced, { number: result.serialNumber, amount: formatBDT(result.totalAmount) }));
            onSaved();
        } catch (err: any) {
            toast.error(err?.message || f.invoiceFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <form onSubmit={save} className="flex max-h-[90vh] flex-col overflow-hidden">
                <ModalHeader title={f.raiseInvoice} onClose={onClose} />
                <div className="space-y-3 overflow-y-auto p-3 md:p-4">
                    <p className="text-sm text-gray-700">
                        {fmt(f.invoiceTo, { customer: customerName ?? '—' })}
                        {request.kind !== 'AMOUNT' && <span className="block text-xs text-gray-500">{request.label}</span>}
                    </p>
                    {products.length === 0 ? (
                        <Alert tone="warning">{f.noBillingProducts}</Alert>
                    ) : (
                        <Field label={f.billingProduct} htmlFor="invoice-product">
                            <Select id="invoice-product" value={productId} onChange={(e) => setProductId(e.target.value)} className="w-full">
                                <option value="">—</option>
                                {products.map((product) => (
                                    <option key={product.id} value={product.id}>{product.name}</option>
                                ))}
                            </Select>
                        </Field>
                    )}
                    {request.kind === 'AMOUNT' && (
                        <Field label={f.description} htmlFor="invoice-description">
                            <Input
                                id="invoice-description"
                                value={description}
                                maxLength={200}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </Field>
                    )}
                    <Field label={f.amount} htmlFor="invoice-amount">
                        <Input
                            id="invoice-amount"
                            type="number"
                            min="0.01"
                            step="0.01"
                            inputMode="decimal"
                            value={amount}
                            readOnly={request.kind !== 'AMOUNT'}
                            onChange={(e) => setAmount(e.target.value)}
                        />
                    </Field>
                    <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                        <Checkbox checked={includesVat} onChange={(e) => setIncludesVat(e.target.checked)} />
                        {f.amountIncludesVat}
                    </label>
                    <Field label={f.date} htmlFor="invoice-date">
                        <Input id="invoice-date" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
                    </Field>
                    <p className="text-xs text-gray-500">{f.invoiceCreditNote}</p>
                </div>
                <ModalFooter>
                    <Button variant="secondary" type="button" onClick={onClose}>{t.common.cancel}</Button>
                    <Button type="submit" loading={saving} disabled={!valid}>{f.raiseInvoice}</Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}
