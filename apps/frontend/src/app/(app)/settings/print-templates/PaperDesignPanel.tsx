'use client';

import { useId, useState } from 'react';
import { Button, ConfirmDialog } from '@/components/ui';
import { isThermalPaper, paperSizeLabel } from '@/lib/print';
import type { PaperSize } from '@/lib/print';
import { useI18n } from '@/lib/i18n';

interface PaperDesignPanelProps {
    /** One of `OWN_DESIGN_PAPERS`. */
    paperSize: PaperSize;
    /** Whether the paper prints a design of its own, or the A4 one. */
    own: boolean;
    onStart: () => void;
    onDrop: () => void;
    /** A paper whose own design this one can start from instead — the other roll. */
    copySource?: PaperSize;
    onCopy?: () => void;
}

/**
 * Says which design the editor is changing while a paper other than A4 is
 * previewed, and switches that paper between the A4 design and its own.
 *
 * The distinction matters most before the switch: a paper that follows A4 is
 * edited through the A4 design, so a change made "for A5" lands on A4 too.
 *
 * A roll says so too, since it does not print the A4 design as drawn: it
 * shrinks it to fit, until the roll has a design of its own.
 */
export default function PaperDesignPanel({ paperSize, own, onStart, onDrop, copySource, onCopy }: PaperDesignPanelProps) {
    const { t, fmt } = useI18n();
    const copy = t.settingsExtras.printTemplates.paperDesigns;
    const titleId = useId();
    const [confirmDrop, setConfirmDrop] = useState(false);
    const paper = paperSizeLabel(paperSize);
    const roll = isThermalPaper(paperSize);
    const note = own ? (roll ? copy.ownRoll : copy.own) : (roll ? copy.followsRoll : copy.follows);

    return (
        <div role="group" aria-labelledby={titleId} className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
            <h3 id={titleId} className="text-xs font-semibold text-gray-700">
                {fmt(copy.title, { paper })}
            </h3>
            <p className="text-xs text-gray-500">{fmt(note, { paper })}</p>
            {own ? (
                <Button variant="secondary" size="sm" onClick={() => setConfirmDrop(true)}>
                    {fmt(copy.drop, { paper })}
                </Button>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={onStart}>
                        {fmt(copy.start, { paper })}
                    </Button>
                    {copySource && onCopy ? (
                        <Button variant="secondary" size="sm" onClick={onCopy}>
                            {fmt(copy.copyFrom, { source: paperSizeLabel(copySource) })}
                        </Button>
                    ) : null}
                </div>
            )}

            <ConfirmDialog
                open={confirmDrop}
                title={fmt(copy.dropTitle, { paper })}
                prompt={fmt(copy.dropBody, { paper })}
                confirmLabel={copy.dropConfirm}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={() => {
                    setConfirmDrop(false);
                    onDrop();
                }}
                onCancel={() => setConfirmDrop(false)}
            />
        </div>
    );
}
