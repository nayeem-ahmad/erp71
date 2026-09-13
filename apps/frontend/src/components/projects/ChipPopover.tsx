'use client';

import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import AnchoredDropdown from '@/components/document-entry/AnchoredDropdown';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { useI18n } from '@/lib/i18n';

export interface ChipOption {
    value: string;
    label: string;
    /** Second line of a row — an email, a story's title, a column's category. */
    subtitle?: string;
    /** Drawn before the label: an avatar, a colour swatch, a priority dot. */
    leading?: ReactNode;
}

/**
 * One of the card's decision fields, as a chip that opens a filterable list.
 *
 * These were six stacked `<select>`s in the sidebar. A native select is the
 * right control for four options and the wrong one for a twenty-person roster
 * or a groomed backlog: it cannot be typed into, so picking somebody means
 * reading the whole list. This is the same write — the same PATCH, the same
 * `''`-means-nobody convention — behind a control you can type at.
 *
 * **The panel portals out of the card.** In the modal the chip row sits inside
 * `overflow-y-auto`, which clips an in-flow panel; `AnchoredDropdown` renders
 * into `document.body` and flips above the chip when the room below runs out.
 * That is why this builds on it rather than on the simpler in-flow popover
 * `BoardViewMenu` uses.
 *
 * Keyboard and screen-reader behaviour is hand-built here because a chip is not
 * a form control: the trigger carries its own `aria-label` (a `<label
 * htmlFor>` has no control to point at), the list is a `listbox` of `option`s,
 * and Escape returns focus to the chip rather than dropping a keyboard user at
 * the top of the document.
 */
export default function ChipPopover({
    label,
    value,
    display,
    options,
    onPick,
    onOpen,
    disabled,
    tone = 'default',
    filterable,
    emptyLabel,
}: {
    /** Names the field, for the trigger's accessible name. */
    label: string;
    /** The selected option's value, or '' for none. */
    value: string;
    /** What the chip reads when closed — usually the option's label. */
    display: ReactNode;
    options: ChipOption[];
    /** Given '' when the "none" row is picked. */
    onPick: (value: string) => void;
    /** Fires on first open, so a lazily-fetched list loads then. */
    onOpen?: () => void;
    disabled?: boolean;
    /** `muted` is the empty state: nothing chosen yet. */
    tone?: 'default' | 'muted' | 'warning';
    /**
     * Show the filter box. Left to the caller rather than inferred from
     * `options.length`, so a control does not grow a search box the first time
     * somebody's roster crosses a threshold.
     */
    filterable?: boolean;
    /** The "none" row — omitted entirely when the field cannot be cleared. */
    emptyLabel?: string;
}) {
    const { t } = useI18n();

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);

    const boxRef = useRef<HTMLDivElement>(null);
    const chipRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const panelId = useId();

    // Both the chip and the portalled panel count as "inside": the panel is not
    // a DOM descendant of the chip, so a containment test on `boxRef` alone
    // closes the popover the moment anybody clicks in it.
    const isInside = useCallback(
        (target: Node) =>
            Boolean(boxRef.current?.contains(target)) ||
            Boolean(panelRef.current?.contains(target)),
        [],
    );
    const close = useCallback(() => {
        setOpen(false);
        setQuery('');
    }, []);
    useDismissOnClickOutside(open, isInside, close);

    const rows = useMemo(() => {
        const all = emptyLabel != null ? [{ value: '', label: emptyLabel }, ...options] : options;
        const needle = query.trim().toLowerCase();
        if (!needle) return all;
        // The empty row is never filtered out: "clear this" has to stay
        // reachable while a search is narrowing everything else away.
        return all.filter(
            (row) =>
                row.value === '' ||
                row.label.toLowerCase().includes(needle) ||
                (row.subtitle ?? '').toLowerCase().includes(needle),
        );
    }, [options, emptyLabel, query]);

    useEffect(() => {
        if (!open) return;
        setActive(Math.max(0, rows.findIndex((row) => row.value === value)));
    }, [open, value, rows]);

    useEffect(() => {
        if (open && filterable) searchRef.current?.focus();
    }, [open, filterable]);

    const pick = (next: string) => {
        close();
        chipRef.current?.focus();
        if (next !== value) onPick(next);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            // Kept off the document: inside the modal a bubbling Escape is read
            // as "close the card", which would take the popover and the card.
            event.stopPropagation();
            close();
            chipRef.current?.focus();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current) => {
                if (rows.length === 0) return 0;
                return (current + step + rows.length) % rows.length;
            });
            return;
        }
        if (event.key === 'Enter' && rows[active]) {
            event.preventDefault();
            pick(rows[active].value);
        }
    };

    const toneClass =
        tone === 'warning'
            ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
            : tone === 'muted'
              ? 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
              : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100';

    return (
        <div ref={boxRef} className="inline-flex">
            <button
                ref={chipRef}
                type="button"
                disabled={disabled}
                aria-label={label}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-controls={open ? panelId : undefined}
                onClick={() => {
                    if (!open) onOpen?.();
                    setOpen((was) => !was);
                }}
                onKeyDown={open ? onKeyDown : undefined}
                className={`inline-flex min-h-touch items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 md:min-h-0 ${toneClass}`}
            >
                {display}
                <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
            </button>

            {open && (
                <AnchoredDropdown
                    anchorRef={chipRef}
                    panelRef={panelRef}
                    matchAnchorWidth={false}
                    className="min-w-56 border-gray-200 p-1"
                    role="listbox"
                    aria-label={label}
                >
                    {filterable && (
                        <input
                            ref={searchRef}
                            value={query}
                            aria-label={t.common.search}
                            placeholder={t.common.search}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={onKeyDown}
                            className="mb-1 w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm focus:border-primary/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    )}

                    {rows.length === 0 ? (
                        <p className="px-2 py-1.5 text-xs text-gray-500">{t.common.noData}</p>
                    ) : (
                        rows.map((row, index) => {
                            const on = row.value === value;
                            return (
                                <button
                                    key={row.value || '__none__'}
                                    type="button"
                                    role="option"
                                    aria-selected={on}
                                    onMouseEnter={() => setActive(index)}
                                    onClick={() => pick(row.value)}
                                    className={`flex min-h-touch w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm md:min-h-0 ${
                                        index === active ? 'bg-blue-50' : ''
                                    } ${row.value === '' ? 'text-gray-500' : 'text-gray-900'}`}
                                >
                                    {row.leading}
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate">{row.label}</span>
                                        {row.subtitle && (
                                            <span className="block truncate text-xs text-gray-400">
                                                {row.subtitle}
                                            </span>
                                        )}
                                    </span>
                                    {on && (
                                        <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden />
                                    )}
                                </button>
                            );
                        })
                    )}
                </AnchoredDropdown>
            )}
        </div>
    );
}
