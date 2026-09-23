'use client';

import { RotateCcw } from 'lucide-react';
import { Button, Checkbox, Switch } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import {
    CARD_FIELDS,
    isDefaultBoardView,
    type BoardCardField,
    type BoardColumnTint,
    type BoardColumnWidth,
    type BoardDensity,
    type BoardScroll,
    type BoardSwimlanes,
} from './board-view';
import type { BoardViewControls } from './use-board-view';

/**
 * The board's appearance controls — swimlanes, card size, column width, column colour,
 * where a board taller than the window scrolls, motion and which fields a card
 * shows.
 *
 * These used to be a popover of their own hanging off the board header, beside
 * a Background button and a Board settings link. Three entry points for "change
 * something about this board" is two too many, so they now live in the board
 * settings panel with the columns and the background. What that costs is the
 * live preview the popover had — the board is behind the panel while these are
 * being changed. What it buys is a header that fits on a phone, and one place
 * to look. Nothing here has a Save button either way: every control writes
 * through on the click, so closing the panel shows the result immediately.
 *
 * The settings are this browser's, not the board's: see `board-view.ts`. That
 * is why they sit in their own section rather than beside the background, which
 * everyone in the workspace sees.
 */
export default function BoardAppearanceControls({ view, set, toggleField, reset }: BoardViewControls) {
    const { t } = useI18n();
    const v = t.projects.board.view;

    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-gray-500">{v.scopeHint}</p>
                {/* Offered only once there is something to undo: a Reset that
                    resets nothing is a control that has to be read before it
                    can be ignored. */}
                {!isDefaultBoardView(view) && (
                    <Button variant="ghost" className="shrink-0" onClick={reset}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        {v.reset}
                    </Button>
                )}
            </div>

            {/* First, because it changes the board more than anything under
                it: the rest restyle the same columns, this one reshapes them
                into rows. */}
            <Segmented<BoardSwimlanes>
                label={v.swimlanes}
                hint={v.swimlanesHint}
                value={view.swimlanes}
                onChange={(next) => set('swimlanes', next)}
                options={[
                    { value: 'none', label: v.swimlanesNone },
                    { value: 'assignee', label: v.swimlanesAssignee },
                    { value: 'story', label: v.swimlanesStory },
                ]}
            />

            <div className="grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-3">
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
            </div>

            {/* A row of its own rather than a fourth cell in the grid above.
                Card size, column width and colour are all self-evident from
                their two or three options; this one is not until you have read
                what it does to the page, so it needs the line underneath. */}
            <div className="border-t border-gray-100 pt-3">
                <Segmented<BoardScroll>
                    label={v.scroll}
                    hint={v.scrollHint}
                    value={view.scroll}
                    onChange={(next) => set('scroll', next)}
                    options={[
                        { value: 'page', label: v.scrollPage },
                        { value: 'column', label: v.scrollColumn },
                    ]}
                />
            </div>

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
                <legend className="mb-1.5 text-xs font-medium text-gray-600">{v.showOnCards}</legend>
                <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">
                    {CARD_FIELDS.map((field) => (
                        <label
                            key={field}
                            className="flex min-h-touch items-center gap-2 text-xs text-gray-700 md:min-h-0 md:py-1"
                        >
                            <Checkbox checked={view.fields[field]} onChange={() => toggleField(field)} />
                            {v.fields[field as BoardCardField]}
                        </label>
                    ))}
                </div>
            </fieldset>
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
    hint,
    value,
    options,
    onChange,
}: {
    label: string;
    /** A line under the label, for a choice whose options do not explain themselves. */
    hint?: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (next: T) => void;
}) {
    return (
        <div role="group" aria-label={label}>
            <p className={`text-xs font-medium text-gray-600 ${hint ? '' : 'mb-1.5'}`}>{label}</p>
            {hint && <p className="mb-1.5 mt-0.5 text-xs text-gray-400">{hint}</p>}
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
