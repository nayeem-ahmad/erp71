'use client';

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, CompactSection, Input } from '@/components/ui';
import { movedFar } from '@/components/projects/board-drag';
import { reorderByDrag } from '@/components/projects/checklist-reorder';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import type { ChecklistItem } from './model';

/** Marks a checklist row so a drag can tell which one the pointer is over. */
const CHECKLIST_ITEM_ATTR = 'data-checklist-item';

export default function ChecklistSection({
    taskId,
    items,
    onChanged,
}: {
    taskId: string;
    items: ChecklistItem[];
    onChanged: () => Promise<void>;
}) {
    const { t } = useI18n();
    const m = t.projects.checklist;
    /** The board card already says this; a second "Drag to move" in nine
        catalogues would be the same sentence twice. */
    const dragLabel = t.projects.board.card.drag;
    /** The add form is behind the "+" in this section's header. */
    const [adding, setAdding] = useState(false);

    const [newText, setNewText] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [saving, setSaving] = useState(false);

    const done = items.filter((item) => item.is_done).length;
    const percent = items.length === 0 ? 0 : Math.round((done / items.length) * 100);

    const run = async (action: () => Promise<unknown>) => {
        setSaving(true);
        try {
            await action();
            await onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const add = (e: React.FormEvent) => {
        e.preventDefault();
        const text = newText.trim();
        if (!text) return;
        return run(async () => {
            await api.addTaskChecklistItem(taskId, { text });
            setNewText('');
        });
    };

    const commitEdit = (item: ChecklistItem) => {
        const text = editText.trim();
        setEditingId(null);
        if (!text || text === item.text) return;
        return run(() => api.updateTaskChecklistItem(item.id, { text }));
    };

    // Sends the whole order rather than the swapped pair — a half-applied swap
    // would leave two items sharing a sort_order and the list would reshuffle.
    const moveBy = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= items.length) return;
        const next = [...items];
        [next[index], next[target]] = [next[target], next[index]];
        return run(() => api.reorderTaskChecklist(taskId, next.map((item) => item.id)));
    };

    /**
     * Dragging an item to a new place in the list.
     *
     * Pointer events rather than HTML5 `draggable`, for the reason
     * `board-drag.ts` documents: `dragstart` never fires from touch on iOS
     * Safari or Android Chrome, so a phone could see the handle and not move
     * anything. This is the board's *approach*, not its code — those helpers are
     * two-axis and keyed to columns and cards, and a checklist is one axis.
     *
     * The arrow buttons stay. A drag handle alone is unusable by keyboard, and
     * `moveBy` is already the tested path.
     */
    const [dragging, setDragging] = useState<string | null>(null);
    const [over, setOver] = useState<string | null>(null);
    const origin = useRef<{ x: number; y: number } | null>(null);
    const started = useRef(false);

    const endDrag = () => {
        setDragging(null);
        setOver(null);
        origin.current = null;
        started.current = false;
    };

    const onHandleDown = (item: ChecklistItem) => (event: React.PointerEvent) => {
        // Primary button or touch only: a secondary click opens a context menu
        // rather than starting a drag. (Phrased without the usual hyphenated
        // mouse-button words on purpose — `scripts/rtl-codemod.js` rewrites
        // `right-`/`left-` as plain text, so those spellings fail the RTL
        // no-physical-utilities test even inside a comment.)
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        origin.current = { x: event.clientX, y: event.clientY };
        setDragging(item.id);
    };

    const onHandleMove = (event: React.PointerEvent) => {
        if (!dragging || !origin.current) return;
        // Below the threshold this is a click on the handle, not a drag —
        // the same 6px the board uses.
        if (!started.current) {
            if (!movedFar(origin.current, { x: event.clientX, y: event.clientY })) return;
            started.current = true;
        }
        // `elementFromPoint`, not the event target: the handle has pointer
        // capture, so every move reports the handle no matter what is under it.
        const under = document.elementFromPoint(event.clientX, event.clientY);
        const row = under?.closest(`[${CHECKLIST_ITEM_ATTR}]`);
        const id = row?.getAttribute(CHECKLIST_ITEM_ATTR) ?? null;
        setOver(id && id !== dragging ? id : null);
    };

    const onHandleUp = () => {
        // Read before `endDrag` clears them.
        const next = reorderByDrag(items.map((item) => item.id), dragging, over);
        endDrag();
        if (!next) return;
        // The whole order, exactly as moveBy sends it.
        return run(() => api.reorderTaskChecklist(taskId, next));
    };

    return (
        <CompactSection
            titleStyle="heading"
            title={
                <>
                    {m.title}
                    {items.length > 0 && (
                        <span className="ms-2 text-xs font-normal text-gray-500">
                            {done === items.length
                                ? m.allDone
                                : m.progress
                                      .replace('{done}', String(done))
                                      .replace('{total}', String(items.length))}
                        </span>
                    )}
                </>
            }
            actions={
                <Button
                    type="button"
                    variant="secondary"
                    aria-expanded={adding}
                    onClick={() => setAdding((open) => !open)}
                >
                    <Plus className="h-4 w-4" aria-hidden />
                    {t.projects.card.addChecklistItem}
                </Button>
            }
        >
            {items.length > 0 && (
                <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={m.title}
                >
                    <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${percent}%` }}
                    />
                </div>
            )}

            {items.length === 0 ? (
                <p className="text-sm text-gray-500">{m.empty}</p>
            ) : (
                <ul className="-mx-2 mt-2 space-y-0.5">
                    {items.map((item, index) => (
                        <li
                            key={item.id}
                            {...{ [CHECKLIST_ITEM_ATTR]: item.id }}
                            // `group` so a row's own controls can wait for the
                            // pointer or the keyboard to arrive (below).
                            className={`group flex items-center gap-2 rounded-md px-2 py-0.5 hover:bg-gray-50 ${
                                dragging === item.id ? 'opacity-40' : ''
                            } ${over === item.id ? 'ring-2 ring-blue-400' : ''}`}
                        >
                            {/* Not a button: it drags, it does not activate.
                                The arrows beside it are the keyboard path. */}
                            <span
                                // Decorative, and honestly so: `aria-hidden`
                                // rather than an `aria-label`, because a drag
                                // is not something a screen-reader user can
                                // perform here. The arrow buttons beside it are
                                // the accessible path, and they stay.
                                aria-hidden
                                title={dragLabel}
                                onPointerDown={onHandleDown(item)}
                                onPointerMove={onHandleMove}
                                onPointerUp={onHandleUp}
                                onPointerCancel={endDrag}
                                className="cursor-grab touch-none px-0.5 text-gray-300 hover:text-gray-500"
                            >
                                <GripVertical className="h-4 w-4" />
                            </span>
                            <Checkbox
                                checked={item.is_done}
                                disabled={saving}
                                aria-label={item.text}
                                onChange={() =>
                                    run(() =>
                                        api.updateTaskChecklistItem(item.id, {
                                            isDone: !item.is_done,
                                        }),
                                    )
                                }
                            />

                            {editingId === item.id ? (
                                <Input
                                    autoFocus
                                    value={editText}
                                    className="flex-1"
                                    onChange={(e) => setEditText(e.target.value)}
                                    onBlur={() => commitEdit(item)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            commitEdit(item);
                                        }
                                        if (e.key === 'Escape') setEditingId(null);
                                    }}
                                />
                            ) : (
                                <button
                                    type="button"
                                    className={`max-md:min-h-touch flex-1 text-start text-sm ${
                                        item.is_done ? 'text-gray-400 line-through' : ''
                                    }`}
                                    onClick={() => {
                                        setEditingId(item.id);
                                        setEditText(item.text);
                                    }}
                                >
                                    {item.text}
                                </button>
                            )}

                            {/* Four icons on every row made a five-item list
                                read as a toolbar. From md up they wait for the
                                pointer or the keyboard to reach the row; on a
                                phone, where there is no hover, they stay. */}
                            <span className="flex shrink-0 items-center transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                                <button
                                    type="button"
                                    aria-label={m.moveUp}
                                    className="rounded px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                                    disabled={saving || index === 0}
                                    onClick={() => moveBy(index, -1)}
                                >
                                    <ArrowUp className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    aria-label={m.moveDown}
                                    className="rounded px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                                    disabled={saving || index === items.length - 1}
                                    onClick={() => moveBy(index, 1)}
                                >
                                    <ArrowDown className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    aria-label={m.deleteItem}
                                    className="rounded px-1 text-red-600 hover:text-red-700"
                                    disabled={saving}
                                    onClick={() => run(() => api.deleteTaskChecklistItem(item.id))}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {/* Behind the "+" in the header rather than always open: a card is
                read far more often than it is added to, and a permanently
                open input under the last item made every read scroll past a
                field nobody was filling. */}
            {adding && (
                <form onSubmit={add} className="mt-3 flex gap-2">
                    <Input
                        value={newText}
                        placeholder={m.placeholder}
                        className="flex-1"
                        autoFocus
                        onChange={(e) => setNewText(e.target.value)}
                    />
                    <Button
                        type="submit"
                        variant="secondary"
                        className="max-md:min-h-touch"
                        disabled={saving || newText.trim() === ''}
                    >
                        {m.add}
                    </Button>
                </form>
            )}
        </CompactSection>
    );
}
