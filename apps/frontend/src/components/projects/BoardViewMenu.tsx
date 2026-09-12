'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button, Checkbox, Switch } from '@/components/ui';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { useI18n } from '@/lib/i18n';
import {
    CARD_FIELDS,
    isDefaultBoardView,
    type BoardCardField,
    type BoardColumnTint,
    type BoardColumnWidth,
    type BoardDensity,
} from './board-view';
import type { BoardViewControls } from './use-board-view';

/**
 * The board's appearance controls, in a popover off the page header.
 *
 * A popover rather than a settings page: every one of these is judged by
 * looking at the board behind it, so the board has to stay on screen while they
 * are changed. Nothing here has a Save button for the same reason — the board
 * redraws under the panel as each control is touched, which is the whole
 * feedback loop.
 *
 * The settings are this browser's, not the board's: see `board-view.ts`.
 */
export default function BoardViewMenu({ view, set, toggleField, reset }: BoardViewControls) {
    const { t } = useI18n();
    const v = t.projects.board.view;

    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelId = useId();

    const isInside = useCallback((target: Node) => Boolean(boxRef.current?.contains(target)), []);
    useDismissOnClickOutside(open, isInside, useCallback(() => setOpen(false), []));

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setOpen(false);
            // Focus goes back to the control that opened the panel, or a keyboard
            // user is dropped at the top of the document with the board gone.
            triggerRef.current?.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    return (
        <div ref={boxRef} className="relative">
            <Button
                ref={triggerRef}
                variant="secondary"
                className="min-h-touch"
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-controls={open ? panelId : undefined}
                onClick={() => setOpen((prev) => !prev)}
            >
                <SlidersHorizontal className="h-4 w-4" />
                {v.title}
            </Button>

            {open && (
                <div
                    id={panelId}
                    role="dialog"
                    aria-label={v.title}
                    // Pinned to the logical end edge, so the panel hangs off the
                    // correct side under RTL, where the header actions sit left.
                    className="absolute end-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] space-y-3 rounded-lg border border-gray-200 bg-white p-3 shadow-lg motion-safe:animate-board-menu-in"
                >
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">{v.title}</p>
                        {/* Offered only once there is something to undo: a Reset
                            that resets nothing is a control that has to be read
                            before it can be ignored. */}
                        {!isDefaultBoardView(view) && (
                            <Button variant="ghost" onClick={reset}>
                                <RotateCcw className="h-3.5 w-3.5" />
                                {v.reset}
                            </Button>
                        )}
                    </div>

                    <Segmented<BoardDensity>
                        label={v.cardSize}
                        value={view.density}
                        onChange={(next) => set('density', next)}
                        options={[
                            { value: 'comfortable', label: v.comfortable },
                            { value: 'compact', label: v.compact },
                        ]}
                    />

                    <Segmented<BoardColumnWidth>
                        label={v.columnWidth}
                        value={view.columnWidth}
                        onChange={(next) => set('columnWidth', next)}
                        options={[
                            { value: 'narrow', label: v.narrow },
                            { value: 'standard', label: v.standard },
                            { value: 'wide', label: v.wide },
                        ]}
                    />

                    <Segmented<BoardColumnTint>
                        label={v.columnColor}
                        value={view.columnTint}
                        onChange={(next) => set('columnTint', next)}
                        options={[
                            { value: 'none', label: v.tintNone },
                            { value: 'category', label: v.tintCategory },
                        ]}
                    />

                    <div className="flex items-start justify-between gap-3 border-t border-gray-100 pt-3">
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-600">{v.motion}</p>
                            <p className="mt-0.5 text-xs text-gray-400">{v.motionHint}</p>
                        </div>
                        <Switch
                            checked={view.animate}
                            onCheckedChange={(next) => set('animate', next)}
                            aria-label={v.motion}
                        />
                    </div>

                    <fieldset className="border-t border-gray-100 pt-3">
                        <legend className="mb-1.5 text-xs font-medium text-gray-600">
                            {v.showOnCards}
                        </legend>
                        <div className="grid grid-cols-2 gap-x-3">
                            {CARD_FIELDS.map((field) => (
                                <label
                                    key={field}
                                    className="flex min-h-touch items-center gap-2 text-xs text-gray-700 md:min-h-0 md:py-1"
                                >
                                    <Checkbox
                                        checked={view.fields[field]}
                                        onChange={() => toggleField(field)}
                                    />
                                    {v.fields[field as BoardCardField]}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                </div>
            )}
        </div>
    );
}

/**
 * A row of mutually exclusive choices. Toggle buttons with `aria-pressed`
 * rather than `role="radio"`: a radiogroup promises arrow-key navigation and a
 * roving tabindex, and a half-kept ARIA promise reads worse to a screen reader
 * than the plainer control these actually are.
 */
function Segmented<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (next: T) => void;
}) {
    return (
        <div role="group" aria-label={label}>
            <p className="mb-1.5 text-xs font-medium text-gray-600">{label}</p>
            <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
                {options.map((option) => {
                    const selected = option.value === value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => onChange(option.value)}
                            className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors max-md:min-h-touch ${
                                selected
                                    ? 'bg-white text-blue-700 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900'
                            }`}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
