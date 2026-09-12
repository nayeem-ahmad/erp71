'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A card section that costs nothing until somebody opens it.
 *
 * The task card used to fetch everything it could ever show on mount —
 * attachments, comments, the activity feed, the watcher list — which is six of
 * the ten requests opening a card used to make, all of them for sections below
 * the fold that most readers never scroll to. `onFirstOpen` fires once, the
 * first time the section is expanded, so the cost follows the interest.
 *
 * The count in the header is the part that makes this honest: a collapsed
 * section that cannot say whether it holds anything is a section people open
 * to check, which is worse than no collapse at all. Where a count is not known
 * without fetching, pass none and the header simply does not claim one.
 */
export default function CollapsibleSection({
    title,
    count,
    children,
    onFirstOpen,
    defaultOpen = false,
}: {
    title: string;
    count?: number;
    children: ReactNode;
    onFirstOpen?: () => void;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const opened = useRef(false);

    useEffect(() => {
        if (!open || opened.current) return;
        opened.current = true;
        onFirstOpen?.();
    }, [open, onFirstOpen]);

    return (
        <section className="rounded-md border border-gray-200">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((was) => !was)}
                className="flex min-h-touch w-full items-center justify-between gap-2 px-3 py-2 text-start"
            >
                <span className="flex items-center gap-2 text-sm font-medium">
                    {title}
                    {count != null && count > 0 && (
                        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-600">
                            {count}
                        </span>
                    )}
                </span>
                <ChevronDown
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                    aria-hidden
                />
            </button>
            {/* Unmounted rather than hidden: a closed section that still holds a
                mounted feed is a closed section that still fetches. */}
            {open && <div className="border-t border-gray-200 p-3">{children}</div>}
        </section>
    );
}
