'use client';

import { ChevronDown, Crosshair } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * A swimlane's heading on the sprint page, shared by the table and the card
 * view: the fold toggle with the lane's name and count, and a button that
 * folds every *other* lane — the quick way to read one person's or one story's
 * work without scrolling past everyone else's.
 */
export default function SprintLaneHeading({
    title,
    count,
    collapsed,
    focused,
    onToggle,
    onFocus,
}: {
    title: string;
    count: number;
    collapsed: boolean;
    /** This is the only lane open while others are folded; the button then reopens them. */
    focused: boolean;
    onToggle: () => void;
    onFocus: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects;

    return (
        <span className="flex min-w-0 items-center gap-1">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={!collapsed}
                title={collapsed ? m.board.laneExpand : m.board.laneCollapse}
                className="-ms-1 inline-flex min-h-touch min-w-0 items-center gap-1 rounded px-1 text-start hover:bg-gray-200 md:min-h-0 md:py-0.5"
            >
                <ChevronDown
                    className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${collapsed ? '-rotate-90 rtl:rotate-90' : ''}`}
                    aria-hidden
                />
                <span className="truncate">{title}</span>
                <span className="shrink-0 font-normal text-gray-500">{count}</span>
                <span className="sr-only">{collapsed ? m.board.laneExpand : m.board.laneCollapse}</span>
            </button>
            <button
                type="button"
                onClick={onFocus}
                aria-pressed={focused}
                aria-label={focused ? m.sprint.expandAllLanes : m.sprint.focusLane}
                title={focused ? m.sprint.expandAllLanes : m.sprint.focusLane}
                className={`inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded md:min-h-0 md:min-w-0 md:p-1 ${
                    focused ? 'text-blue-600 hover:bg-blue-50' : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                }`}
            >
                <Crosshair className="h-3.5 w-3.5" aria-hidden />
            </button>
        </span>
    );
}
