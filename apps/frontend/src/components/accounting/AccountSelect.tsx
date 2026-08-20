'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export interface AccountOption {
    id: string;
    name: string;
    code?: string | null;
}

/**
 * Chart-of-accounts order. Codes are fixed-width and prefix-nested, so a plain
 * string sort over them is the hierarchy; anything still uncoded sorts last by
 * name rather than jumping to the front of the list.
 */
export function sortAccountsByCode<T extends AccountOption>(accounts: T[]): T[] {
    return [...accounts].sort((a, b) => {
        if (a.code && b.code && a.code !== b.code) return a.code < b.code ? -1 : 1;
        if (Boolean(a.code) !== Boolean(b.code)) return a.code ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

export function accountLabel(account: AccountOption): string {
    return account.code ? `${account.code} — ${account.name}` : account.name;
}

function matches(account: AccountOption, query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (
        account.name.toLowerCase().includes(needle)
        || (account.code ?? '').toLowerCase().includes(needle)
    );
}

interface AccountSelectProps {
    accounts: AccountOption[];
    value: string;
    onChange: (accountId: string) => void;
    /** Shown on the trigger when nothing is selected. */
    placeholder?: string;
    ariaLabel: string;
    disabled?: boolean;
    /** Applied to the trigger button so callers keep control of density. */
    className?: string;
    title?: string;
    /** Renders an explicit "no account" entry at the top of the list. */
    allowClear?: boolean;
    clearLabel?: string;
    invalid?: boolean;
}

/**
 * Account picker with a code-ordered, searchable list.
 *
 * A native `<select>` cannot be filtered, and a tenant's chart of accounts runs
 * to hundreds of rows — so this is a listbox with its own search field. The
 * popup is positioned `fixed` off the trigger's rect: voucher entry mounts one
 * of these inside a scrolling table, and an absolutely-positioned panel would
 * be clipped by that container.
 */
export default function AccountSelect({
    accounts,
    value,
    onChange,
    placeholder,
    ariaLabel,
    disabled = false,
    className = '',
    title,
    allowClear = false,
    clearLabel,
    invalid = false,
}: Readonly<AccountSelectProps>) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlight, setHighlight] = useState(0);
    const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const sorted = useMemo(() => sortAccountsByCode(accounts), [accounts]);
    const visible = useMemo(() => sorted.filter((account) => matches(account, query)), [sorted, query]);
    const selected = accounts.find((account) => account.id === value) ?? null;

    const position = () => {
        const bounds = triggerRef.current?.getBoundingClientRect();
        if (!bounds) return;
        setRect({ top: bounds.bottom, left: bounds.left, width: bounds.width });
    };

    const close = () => {
        setOpen(false);
        setQuery('');
        setHighlight(0);
    };

    useLayoutEffect(() => {
        if (!open) return;
        position();
        searchRef.current?.focus();
    }, [open]);

    // The trigger can be inside a scrolling table, so follow it rather than
    // leaving the panel stranded where it opened.
    useEffect(() => {
        if (!open) return;

        const reposition = () => position();
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        return () => {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
            close();
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [open]);

    // Keep the highlighted row in view while arrowing through a long chart.
    useEffect(() => {
        if (!open) return;
        const node = listRef.current?.children[highlight] as HTMLElement | undefined;
        // Guarded: jsdom has no scrollIntoView, and this is pure polish anyway.
        node?.scrollIntoView?.({ block: 'nearest' });
    }, [highlight, open]);

    const commit = (accountId: string) => {
        onChange(accountId);
        close();
        triggerRef.current?.focus();
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            triggerRef.current?.focus();
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight((current) => Math.min(current + 1, visible.length - 1));
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight((current) => Math.max(current - 1, 0));
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const choice = visible[highlight];
            if (choice) commit(choice.id);
        }
    };

    const triggerLabel = selected ? accountLabel(selected) : (placeholder ?? t.accountingShared.selectAccountPlaceholder);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                title={title}
                disabled={disabled}
                onClick={() => (open ? close() : setOpen(true))}
                className={`flex w-full items-center justify-between gap-1 text-start disabled:opacity-60 ${
                    invalid ? 'border-red-300' : ''
                } ${className}`}
            >
                <span className={`truncate ${selected ? 'text-gray-900' : 'text-gray-400'}`}>
                    {triggerLabel}
                </span>
                <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
            </button>

            {open && rect ? (
                <div
                    ref={panelRef}
                    style={{ top: rect.top + 2, left: rect.left, width: Math.max(rect.width, 260) }}
                    className="fixed z-50 rounded-lg border border-gray-200 bg-white shadow-lg"
                >
                    <div className="flex items-center gap-1.5 border-b border-gray-100 px-2 py-1.5">
                        <Search className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                        <input
                            ref={searchRef}
                            value={query}
                            aria-label={t.accountingShared.searchAccounts}
                            placeholder={t.accountingShared.searchAccounts}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setHighlight(0);
                            }}
                            onKeyDown={handleKeyDown}
                            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
                        />
                    </div>

                    <ul ref={listRef} role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto py-1">
                        {allowClear ? (
                            <li>
                                <button
                                    type="button"
                                    onClick={() => commit('')}
                                    className="min-h-touch flex w-full items-center px-2.5 py-1.5 text-start text-sm text-gray-500 hover:bg-gray-50"
                                >
                                    {clearLabel ?? t.accountingShared.selectAccountPlaceholder}
                                </button>
                            </li>
                        ) : null}
                        {visible.map((account, index) => (
                            <li key={account.id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={account.id === value}
                                    onClick={() => commit(account.id)}
                                    onMouseEnter={() => setHighlight(index)}
                                    className={`min-h-touch flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-sm ${
                                        index === highlight ? 'bg-blue-50' : 'hover:bg-gray-50'
                                    }`}
                                >
                                    <span className="w-14 flex-shrink-0 font-mono text-xs text-gray-500">
                                        {account.code || '—'}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-gray-800">{account.name}</span>
                                    {account.id === value ? (
                                        <Check className="h-3.5 w-3.5 flex-shrink-0 text-blue-600" />
                                    ) : null}
                                </button>
                            </li>
                        ))}
                        {visible.length === 0 ? (
                            <li className="px-2.5 py-3 text-center text-xs text-gray-400">
                                {t.accountingShared.noAccountsFound}
                            </li>
                        ) : null}
                    </ul>
                </div>
            ) : null}
        </>
    );
}
