'use client';

import { useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox, Field, Select } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { PrintDensity } from '@/lib/print';
import { PAPER_SIZES, paperSizeLabel, type PaperSize } from '@/lib/sales-invoice-printer';

export interface PrintSettingsModalProps {
    paperSize: PaperSize;
    skipPreview: boolean;
    density: PrintDensity;
    onSave: (next: { paperSize: PaperSize; skipPreview: boolean; density: PrintDensity }) => void;
    onClose: () => void;
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
 */
export default function PrintSettingsModal({
    paperSize,
    skipPreview,
    density,
    onSave,
    onClose,
}: PrintSettingsModalProps) {
    const { t } = useI18n();
    const copy = t.sales.printSettings;

    // Local until saved, so backing out of the modal leaves the counter's
    // current setup alone.
    const [size, setSize] = useState<PaperSize>(paperSize);
    const [skip, setSkip] = useState(skipPreview);
    const [compact, setCompact] = useState(density === 'compact');

    return (
        <ModalShell onBackdropClick={onClose}>
            <ModalHeader
                title={copy.title}
                subtitle={copy.subtitle}
                onClose={onClose}
                closeLabel={t.common.close}
            />

            <div className="space-y-4 overflow-y-auto p-4">
                <Field label={copy.paperSizeLabel} hint={copy.paperSizeHint}>
                    <Select value={size} onChange={(e) => setSize(e.target.value as PaperSize)}>
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
            </div>

            <ModalFooter>
                <Button type="button" variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button
                    type="button"
                    onClick={() => {
                        onSave({
                            paperSize: size,
                            skipPreview: skip,
                            density: compact ? 'compact' : 'normal',
                        });
                        onClose();
                    }}
                >
                    {t.common.save}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
