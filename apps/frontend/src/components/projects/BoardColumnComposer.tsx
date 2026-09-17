'use client';

import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

/**
 * "Add column" at the end of the board's columns, where Trello and JIRA both
 * put it.
 *
 * Adding a column was previously only possible in board settings, which is the
 * wrong place for it: you notice a lane is missing while looking at the board,
 * and a column is added mid-sentence, not as an act of configuration. The
 * category still has to be asked for — it is what decides whether a card in
 * this lane counts as finished — so it is a select beside the name rather than
 * a guess the board would make and get wrong on a "Blocked" column.
 */
export default function BoardColumnComposer({
    boardId,
    widthClass,
    onCreated,
}: Readonly<{
    boardId: string;
    /** Matches the board's column width, so the tile lines up with the lanes. */
    widthClass: string;
    onCreated: () => void | Promise<void>;
}>) {
    const { t } = useI18n();
    const m = t.projects.boards;
    const categories = t.projects.settings.categories;

    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [category, setCategory] = useState('TODO');
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const close = () => {
        setOpen(false);
        setName('');
        setCategory('TODO');
    };

    const submit = async () => {
        const trimmed = name.trim();
        if (!trimmed || saving) return;
        setSaving(true);
        try {
            await api.createBoardColumn(boardId, { name: trimmed, category });
            toast.success(m.columnAdded);
            // Stays open with the field cleared: a board that is missing one
            // lane is usually missing two, and reopening the composer between
            // them is the friction this control exists to remove.
            setName('');
            inputRef.current?.focus();
            await onCreated();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.common.error);
        } finally {
            setSaving(false);
        }
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={`flex ${widthClass} min-h-touch shrink-0 items-start gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white/50 px-3 py-2 text-start text-sm font-medium text-gray-500 transition-colors hover:border-blue-300 hover:bg-white hover:text-blue-600`}
            >
                <Plus className="h-4 w-4 shrink-0" />
                {m.addColumn}
            </button>
        );
    }

    return (
        <div
            className={`flex ${widthClass} shrink-0 flex-col gap-2 self-start rounded-lg border border-blue-300 bg-white p-2`}
        >
            <Input
                ref={inputRef}
                autoFocus
                value={name}
                aria-label={m.addColumn}
                placeholder={m.columnName}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        submit();
                    }
                    if (event.key === 'Escape') close();
                }}
            />
            <Select
                aria-label={m.category}
                value={category}
                disabled={saving}
                onChange={(event) => setCategory(event.target.value)}
            >
                {Object.entries(categories).map(([key, label]) => (
                    <option key={key} value={key}>
                        {label}
                    </option>
                ))}
            </Select>
            <div className="flex items-center gap-2">
                <Button className="min-h-touch" onClick={submit} disabled={saving || !name.trim()}>
                    {t.common.add}
                </Button>
                <Button variant="secondary" className="min-h-touch" onClick={close}>
                    {t.common.cancel}
                </Button>
            </div>
        </div>
    );
}
