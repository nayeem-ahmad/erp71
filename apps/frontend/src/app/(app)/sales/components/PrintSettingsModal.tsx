'use client';

import { useState } from 'react';
import type { InvoicePrintPrefs } from '@erp71/shared-types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button, Checkbox, Field, Select } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { PrintDensity } from '@/lib/print';
import { PAPER_SIZES, paperSizeLabel, type PaperSize } from '@/lib/sales-invoice-printer';
import InvoiceLayoutFields from './InvoiceLayoutFields';

type InvoiceLayoutChange = Partial<Omit<InvoicePrintPrefs, 'version'>>;

/** The fields the member changed, so a save never restates the rest. */
function changedFields(before: InvoicePrintPrefs, after: InvoicePrintPrefs): InvoiceLayoutChange {
    const change: Record<string, unknown> = {};
    for (const key of Object.keys(after) as (keyof InvoicePrintPrefs)[]) {
        if (key !== 'version' && after[key] !== before[key]) change[key] = after[key];
    }
    return change as InvoiceLayoutChange;
}

export interface PrintSettingsModalProps {
    paperSize: PaperSize;
    skipPreview: boolean;
    density: PrintDensity;
    onSave: (next: { paperSize: PaperSize; skipPreview: boolean; density: PrintDensity }) => void;
    onClose: () => void;
    /**
     * The member's invoice layout (`useInvoicePrintPrefs`), on screens that
     * print sales invoices. Saved to the member's account rather than this
     * device, so it is left out where there are no invoices to lay out.
     */
    invoiceLayout?: {
        prefs: InvoicePrintPrefs;
        save: (change: InvoiceLayoutChange) => Promise<InvoicePrintPrefs>;
    };
}

/**
 * How this counter prints — paper size, whether to preview first, and whether
 * to print compact.
 *
 * All three describe how this counter prints rather than the tenant, so they
 * are saved per device (see `useSalePrintPrefs`). Compact is the one answer
 * every document follows, not only sales — it is the same switch the print
 * windows and the sales print menu show (`usePrintDensity`). That is also
 * why they belong here and not only in Settings → Sales: the shop-wide default
 * is an owner's decision, but the till that actually has the 80mm roll plugged
 * in needs to say so without an admin round trip.
 *
 * Pulling them out of the row's print button is the point of this modal. The
 * size was previously re-chosen from a dropdown on every row, which made
 * printing a chalan a menu scan; it is a setting, set once, and the row is left
 * with nothing but "print this".
 *
 * The invoice layout section is the exception to "per device": it is saved to
 * the member's account, so it is headed apart from the device settings above it.
 */
export default function PrintSettingsModal({
    paperSize,
    skipPreview,
    density,
    onSave,
    onClose,
    invoiceLayout,
}: PrintSettingsModalProps) {
    const { t } = useI18n();
    const copy = t.sales.printSettings;

    // Local until saved, so backing out of the modal leaves the counter's
    // current setup alone.
    const [size, setSize] = useState<PaperSize>(paperSize);
    const [skip, setSkip] = useState(skipPreview);
    const [compact, setCompact] = useState(density === 'compact');
    const [layout, setLayout] = useState(invoiceLayout?.prefs);
    const [saving, setSaving] = useState(false);
    const [layoutError, setLayoutError] = useState(false);

    const handleSave = async () => {
        if (invoiceLayout && layout) {
            const change = changedFields(invoiceLayout.prefs, layout);
            if (Object.keys(change).length > 0) {
                setSaving(true);
                setLayoutError(false);
                try {
                    await invoiceLayout.save(change);
                } catch {
                    // Nothing is saved on a failure, the device settings
                    // included, so one Save either takes all of it or none.
                    setLayoutError(true);
                    setSaving(false);
                    return;
                }
            }
        }
        onSave({ paperSize: size, skipPreview: skip, density: compact ? 'compact' : 'normal' });
        onClose();
    };

    return (
        <ModalShell onBackdropClick={onClose}>
            <ModalHeader
                title={copy.title}
                subtitle={invoiceLayout ? undefined : copy.subtitle}
                onClose={onClose}
                closeLabel={t.common.close}
            />

            <div className="space-y-4 overflow-y-auto p-4">
                {invoiceLayout && (
                    <div>
                        <h3 className="text-sm font-semibold text-gray-700">{copy.deviceHeading}</h3>
                        <p className="text-xs text-gray-400">{copy.subtitle}</p>
                    </div>
                )}
                <Field label={copy.paperSizeLabel} hint={copy.paperSizeHint} htmlFor="print-settings-paper-size">
                    <Select id="print-settings-paper-size" value={size} onChange={(e) => setSize(e.target.value as PaperSize)}>
                        {PAPER_SIZES.map((option) => (
                            <option key={option} value={option}>
                                {paperSizeLabel(option)}
                            </option>
                        ))}
                    </Select>
                </Field>

                <label className="flex min-h-touch cursor-pointer items-start gap-3 sm:min-h-0">
                    <Checkbox
                        checked={skip}
                        onChange={(e) => setSkip(e.target.checked)}
                        className="mt-0.5"
                    />
                    <span>
                        <span className="block text-sm text-gray-700">{copy.skipPreviewLabel}</span>
                        <span className="block text-xs text-gray-400">{copy.skipPreviewHint}</span>
                    </span>
                </label>

                <label className="flex min-h-touch cursor-pointer items-start gap-3 sm:min-h-0">
                    <Checkbox
                        checked={compact}
                        onChange={(e) => setCompact(e.target.checked)}
                        className="mt-0.5"
                    />
                    <span>
                        <span className="block text-sm text-gray-700">{copy.compactLabel}</span>
                        <span className="block text-xs text-gray-400">{copy.compactHint}</span>
                    </span>
                </label>

                {invoiceLayout && layout && (
                    <section className="space-y-4 border-t border-gray-100 pt-4">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-700">{copy.invoiceLayout.heading}</h3>
                            <p className="text-xs text-gray-400">{copy.invoiceLayout.hint}</p>
                        </div>
                        <InvoiceLayoutFields value={layout} onChange={setLayout} />
                        {layoutError && <Alert tone="danger">{copy.invoiceLayout.saveFailed}</Alert>}
                    </section>
                )}
            </div>

            <ModalFooter>
                <Button type="button" variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button type="button" loading={saving} onClick={() => void handleSave()}>
                    {t.common.save}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
