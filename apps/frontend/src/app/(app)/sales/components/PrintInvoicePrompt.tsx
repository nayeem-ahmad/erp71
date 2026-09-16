'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle2, Printer } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Field, Select } from '@/components/ui';
import { PAPER_SIZES, paperSizeLabel, type PaperSize } from '@/lib/sales-invoice-printer';
import { useI18n } from '@/lib/i18n';

export type PrintInvoicePromptProps = {
    /** Sale number the server assigned, so the operator prints the right one. */
    serialNumber: string;
    /** Already-formatted total of the saved sale. */
    total: string;
    paperSize: PaperSize;
    onPaperSizeChange: (size: PaperSize) => void;
    /** Yes — print the saved invoice on the selected paper. */
    onPrint: () => void;
    /** No — the sale stays saved, nothing prints. */
    onDismiss: () => void;
};

/**
 * Asked once, right after a sale is posted: print the invoice now, or not.
 *
 * The screen it opens over has already been cleared for the next customer, so
 * the caller prints a snapshot of what was saved rather than the empty form.
 * Declining is a real answer, not a dead end — the sale record prints the same
 * invoice later, which is what the hint says.
 */
export default function PrintInvoicePrompt({
    serialNumber,
    total,
    paperSize,
    onPaperSizeChange,
    onPrint,
    onDismiss,
}: PrintInvoicePromptProps) {
    const { t, fmt } = useI18n();
    const copy = t.sales.printPrompt;
    const printRef = useRef<HTMLButtonElement>(null);

    // At a counter the answer is almost always yes, so Enter prints; Escape and
    // the backdrop decline. Either way the sale is already saved.
    useEffect(() => {
        printRef.current?.focus();
    }, []);

    return (
        <ModalShell size="sm" onBackdropClick={onDismiss}>
            <ModalHeader
                title={copy.title}
                subtitle={serialNumber}
                onClose={onDismiss}
                closeLabel={t.common.close}
            />

            <div className="space-y-4 overflow-y-auto p-4">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-md bg-emerald-100 p-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm text-gray-700">
                            {fmt(copy.saved, { number: serialNumber, amount: total })}
                        </p>
                        <p className="text-sm font-semibold text-gray-800">{copy.question}</p>
                        <p className="text-xs text-gray-400">{copy.hint}</p>
                    </div>
                </div>

                <Field label={copy.paperSize} htmlFor="print-invoice-paper-size">
                    <Select
                        id="print-invoice-paper-size"
                        value={paperSize}
                        onChange={(event) => onPaperSizeChange(event.target.value as PaperSize)}
                    >
                        {PAPER_SIZES.map((size) => (
                            <option key={size} value={size}>
                                {paperSizeLabel(size)}
                            </option>
                        ))}
                    </Select>
                </Field>
            </div>

            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onDismiss}>
                    {copy.skip}
                </Button>
                <Button
                    ref={printRef}
                    variant="primary"
                    size="md"
                    icon={<Printer className="h-4 w-4" />}
                    onClick={onPrint}
                >
                    {copy.print}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
