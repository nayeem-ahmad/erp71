'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { readRecentOpen, writeRecentOpen, type NavLinkEntry } from '@/lib/recent-nav';

export interface RecentNavSectionProps {
    items: readonly NavLinkEntry[];
    compactNav?: boolean;
    /** Drawn on the dark navy rail (classic sidebar only). */
    navy?: boolean;
    /** Links sit directly under the heading (the app panel) rather than indented under it (the classic tree). */
    flat?: boolean;
}

/**
 * The top of the sidebar: the menu items this member opened last, newest
 * first, so a cashier bouncing between POS, Returns and Customers does not
 * re-open three modules each time. Foldable; the fold is remembered in this
 * browser. Draws nothing until there is something to show.
 */
export default function RecentNavSection({ items, compactNav = false, navy = false, flat = false }: RecentNavSectionProps) {
    const { t } = useI18n();
    const [open, setOpen] = useState(true);
    const listId = useId();

    useEffect(() => {
        setOpen(readRecentOpen());
    }, []);

    if (items.length === 0) return null;

    const navText = compactNav ? 'text-[13px]' : 'text-sm';
    const toggle = () => {
        setOpen((prev) => {
            writeRecentOpen(!prev);
            return !prev;
        });
    };

    const headerCls = flat
        ? `flex w-full items-center gap-2 rounded-lg px-2.5 pb-1 pt-1 max-md:min-h-touch text-xs font-semibold transition-colors ${
            navy ? 'text-slate-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
        }`
        : `flex w-full items-center space-x-3 rtl:space-x-reverse rounded-xl px-3 py-2 transition-all duration-150 ${
            navy ? 'text-slate-300 hover:bg-white/5 hover:text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
        }`;

    // ≥44px rows on a phone, where the drawer is tapped rather than clicked.
    const linkCls = `flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 max-md:min-h-touch ${compactNav ? 'py-1' : 'py-1.5'} ${navText} transition-colors ${
        flat ? '' : 'ms-4'
    } ${navy ? 'text-slate-400 hover:bg-white/5 hover:text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`;

    return (
        <div data-testid="recent-nav" className={flat ? 'mb-3' : 'mb-1'}>
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-controls={listId}
                className={headerCls}
            >
                <History className={`flex-shrink-0 ${flat ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} aria-hidden />
                <span className={flat ? '' : `${navText} font-normal tracking-tight whitespace-nowrap`}>{t.sidebar.recent}</span>
                <ChevronDown
                    className={`ms-auto h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''} ${
                        navy ? 'text-slate-500' : 'text-gray-300'
                    }`}
                    aria-hidden
                />
            </button>
            {open ? (
                <ul id={listId} aria-label={t.sidebar.recent} className="mt-0.5 space-y-0.5">
                    {items.map((item) => {
                        const Icon = item.icon;
                        // A module's own page ("Dashboard") needs no module beside it.
                        const showModule = item.moduleLabel && item.moduleLabel !== item.label;
                        return (
                            <li key={item.href}>
                                <Link
                                    href={item.href}
                                    title={showModule ? `${item.moduleLabel} › ${item.label}` : item.label}
                                    className={linkCls}
                                >
                                    <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                                    <span className="min-w-0 truncate">{item.label}</span>
                                    {showModule ? (
                                        <span className={`ms-auto min-w-0 flex-shrink truncate text-xs ${navy ? 'text-slate-500' : 'text-gray-400'}`}>
                                            {item.moduleLabel}
                                        </span>
                                    ) : null}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}
