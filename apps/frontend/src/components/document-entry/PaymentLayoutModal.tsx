'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { PaymentLayoutEntry } from '@erp71/shared-types';
import type { PaymentMethodRow } from '@/lib/api';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox } from '@/components/ui';
import { toast } from '@/lib/toast';

/** The words the Customise modal shows. `{method}` is substituted. */
export interface PaymentLayoutModalLabels {
    customiseTitle: string;
    resetLayout: string;
    saveLayout: string;
    cancelLayout: string;
    moveUp: string;
    moveDown: string;
    showMethod: string;
    /** Toasted when the server refuses and says nothing useful of its own. */
    layoutSaveFailed: string;
}

interface PaymentLayoutModalProps {
    /** Every method the branch offers, in the user's current order. */
    methods: PaymentMethodRow[];
    /** Ids of the ones currently tucked away. */
    hiddenIds: string[];
    onSave: (entry: PaymentLayoutEntry) => Promise<void>;
    onReset: () => Promise<void>;
    onClose: () => void;
    labels: PaymentLayoutModalLabels;
}

/**
 * Edits one user's payment strip for one branch and screen: tick the methods to
 * show, and move them up or down. Saving sends the whole order and the
 * unticked ids, so a method added by an admin later is the server's to place.
 *
 * The caller does the saving and hands the answer back to the strip; this only
 * decides when to close. A refusal toasts through the global Toaster and leaves
 * the modal open with what the user had arranged.
 */
export default function PaymentLayoutModal({
    methods,
    hiddenIds,
    onSave,
    onReset,
    onClose,
    labels,
}: PaymentLayoutModalProps) {
    // Shown ones first, in their order, then the hidden ones — the strip's
    // order is the shown ones', and the hidden ones wait below.
    const [rows, setRows] = useState(() => {
        const hidden = new Set(hiddenIds);
        return [...methods.filter((m) => !hidden.has(m.id)), ...methods.filter((m) => hidden.has(m.id))];
    });
    const [hidden, setHidden] = useState<string[]>(hiddenIds);
    const [busy, setBusy] = useState(false);

    const move = (index: number, by: -1 | 1) =>
        setRows((current) => {
            const next = current.slice();
            [next[index], next[index + by]] = [next[index + by], next[index]];
            return next;
        });

    const toggle = (id: string) =>
        setHidden((current) => (current.includes(id) ? current.filter((h) => h !== id) : [...current, id]));

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        try {
            await action();
        } catch (err) {
            toast.error(err instanceof Error && err.message ? err.message : labels.layoutSaveFailed);
            setBusy(false);
            return;
        }
        onClose();
    };

    const save = () =>
        run(() => onSave({ order: rows.map((m) => m.id), hidden: rows.filter((m) => hidden.includes(m.id)).map((m) => m.id) }));

    return (
        <ModalShell size="sm" onBackdropClick={busy ? undefined : onClose} dismissOnBackdrop={false}>
            <ModalHeader title={labels.customiseTitle} onClose={busy ? undefined : onClose} />
            <ul className="divide-y divide-gray-100 overflow-y-auto px-4 py-1">
                {rows.map((m, index) => (
                    <li key={m.id} className="flex items-center gap-2 py-1.5">
                        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-gray-700">
                            <Checkbox
                                checked={!hidden.includes(m.id)}
                                onChange={() => toggle(m.id)}
                                disabled={busy}
                                aria-label={labels.showMethod.replace('{method}', m.name)}
                            />
                            <span className="truncate" title={m.name}>{m.name}</span>
                        </label>
                        <Button
                            variant="ghost"
                            size="icon"
                            icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />}
                            aria-label={labels.moveUp.replace('{method}', m.name)}
                            disabled={busy || index === 0}
                            onClick={() => move(index, -1)}
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            icon={<ArrowDown className="h-4 w-4" aria-hidden="true" />}
                            aria-label={labels.moveDown.replace('{method}', m.name)}
                            disabled={busy || index === rows.length - 1}
                            onClick={() => move(index, 1)}
                        />
                    </li>
                ))}
            </ul>
            <ModalFooter className="justify-between">
                <Button variant="ghost" disabled={busy} onClick={() => run(onReset)}>
                    {labels.resetLayout}
                </Button>
                <div className="flex gap-2">
                    <Button variant="secondary" disabled={busy} onClick={onClose}>
                        {labels.cancelLayout}
                    </Button>
                    <Button loading={busy} onClick={save}>
                        {labels.saveLayout}
                    </Button>
                </div>
            </ModalFooter>
        </ModalShell>
    );
}
