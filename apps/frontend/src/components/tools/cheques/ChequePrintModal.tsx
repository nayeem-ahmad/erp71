'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox, Field, FormGrid, Input } from '@/components/ui';
import {
    buildChequeHtml,
    CHEQUE_HEIGHT_MM,
    CHEQUE_WIDTH_MM,
    printCheque,
    readChequeOffset,
    saveChequeOffset,
} from '@/lib/cheque-print';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { Cheque } from '../types';

/** 1 mm on screen at 96 dpi. The preview is drawn at this scale and shrunk to fit. */
const PX_PER_MM = 96 / 25.4;

/**
 * Print one cheque onto a bank leaf, with a live preview and a nudge for the
 * printer's feed. The preview is the same HTML the print window gets.
 */
export function ChequePrintModal({ cheque, onClose }: { cheque: Cheque; onClose: () => void }) {
    const { t, fmt } = useI18n();
    const m = t.tools.cheques.print;
    const initial = useMemo(() => readChequeOffset(cheque.bank_name), [cheque.bank_name]);
    const [offsetX, setOffsetX] = useState(String(initial.offsetX));
    const [offsetY, setOffsetY] = useState(String(initial.offsetY));
    const [showGuide, setShowGuide] = useState(false);

    const options = {
        offsetX: Number(offsetX) || 0,
        offsetY: Number(offsetY) || 0,
        showGuide: true,
        acPayeeLabel: m.acPayee,
    };
    const data = {
        partyName: cheque.party_name,
        amount: cheque.amount,
        chequeDate: cheque.cheque_date,
        accountPayee: cheque.account_payee,
        bankName: cheque.bank_name,
    };
    const previewHtml = buildChequeHtml(data, options);

    const print = () => {
        saveChequeOffset(cheque.bank_name, options.offsetX, options.offsetY);
        const win = printCheque(data, { ...options, showGuide });
        if (!win) toast.error(m.popupBlocked);
    };

    return (
        <ModalShell size="lg" onBackdropClick={onClose}>
            <ModalHeader title={m.title} subtitle={`${cheque.bank_name} · ${cheque.cheque_number}`} onClose={onClose} />
            <div className="space-y-3 overflow-y-auto p-4">
                <p className="text-sm text-gray-600">{m.intro}</p>

                <div>
                    <p className="text-xs font-medium text-gray-600">{m.preview}</p>
                    <div className="mt-1 overflow-hidden rounded-md border border-gray-200 bg-gray-50 p-2">
                        <ChequePreview html={previewHtml} title={m.preview} />
                    </div>
                </div>

                <FormGrid>
                    <Field label={m.offsetX} htmlFor="cheque-offset-x">
                        <Input id="cheque-offset-x" type="number" step="0.5" value={offsetX} onChange={(e) => setOffsetX(e.target.value)} className="w-full" />
                    </Field>
                    <Field label={m.offsetY} htmlFor="cheque-offset-y">
                        <Input id="cheque-offset-y" type="number" step="0.5" value={offsetY} onChange={(e) => setOffsetY(e.target.value)} className="w-full" />
                    </Field>
                </FormGrid>
                <p className="text-xs text-gray-500">{fmt(m.offsetHint, { bank: cheque.bank_name })}</p>

                <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                    <Checkbox checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} />
                    {m.showGuide}
                </label>
            </div>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button onClick={print}>{m.printNow}</Button>
            </ModalFooter>
        </ModalShell>
    );
}

/** The slip drawn at real size in a sandboxed frame, scaled down to the dialog's width. */
function ChequePreview({ html, title }: { html: string; title: string }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        const fit = () => setScale(box.clientWidth / (CHEQUE_WIDTH_MM * PX_PER_MM));
        fit();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(fit);
        observer.observe(box);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={boxRef} className="relative w-full" style={{ aspectRatio: `${CHEQUE_WIDTH_MM} / ${CHEQUE_HEIGHT_MM}` }}>
            <iframe
                title={title}
                srcDoc={html}
                sandbox=""
                className="pointer-events-none absolute start-0 top-0 origin-top-left border-0 bg-white"
                style={{
                    width: `${CHEQUE_WIDTH_MM * PX_PER_MM}px`,
                    height: `${CHEQUE_HEIGHT_MM * PX_PER_MM}px`,
                    transform: `scale(${scale})`,
                }}
            />
        </div>
    );
}
