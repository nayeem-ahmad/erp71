'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { Field } from '@/components/ui';
import AnchoredDropdown from '@/components/document-entry/AnchoredDropdown';
import { useI18n } from '@/lib/i18n';

/**
 * Enough of a `CrmContact` to seed a lead from it — the same fields
 * `prefillLeadFromContact` reads, plus the display bits for a result row.
 */
export type PickedContact = {
    id: string;
    name: string;
    company?: string | null;
    mobile?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    linkedin_url?: string | null;
    website_url?: string | null;
    /** The contact's owner; the lead inherits it when it has one. */
    assigned_to?: string | null;
};

type Props = {
    /** The contact the new lead will be filed against; null means "none". */
    selected: { id: string; name: string } | null;
    /** A contact row (not just an id) — the caller seeds the form from it. */
    onPick: (contact: PickedContact | null) => void;
    /** Confirmation under the box once a contact is linked, e.g. a link to it. */
    hint?: ReactNode;
    /** Shown in place of the hint when the contact could not be loaded. */
    error?: string;
};

const SEARCH_DEBOUNCE_MS = 300;
const RESULT_LIMIT = 20;

/**
 * "File this lead against an existing contact" on the New Lead form.
 *
 * Contacts are searched on the server — a tenant can hold thousands, so the
 * list is never fetched whole. The box browses the first page on focus and
 * narrows on typing, the same typeahead the entry screens use.
 */
export default function LeadContactPicker({ selected, onPick, hint, error }: Readonly<Props>) {
    const { t } = useI18n();
    const m = t.crm.leads;
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PickedContact[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
    const inputId = useId();

    // Fetch whenever the panel is open, including on an empty term — that
    // browsable first page is what makes this a picker and not a blind search.
    useEffect(() => {
        if (!open) return;

        // Loading starts now rather than when the debounce fires, so the rows
        // already on screen do not read as the answer to the new term.
        setLoading(true);
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const data = await api.getContacts({
                    search: query.trim() || undefined,
                    limit: RESULT_LIMIT,
                });
                if (cancelled) return;
                setResults(Array.isArray(data?.items) ? data.items : []);
                setHighlight(0);
            } catch {
                if (!cancelled) setResults([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, open]);

    // Keep the highlighted row visible while arrowing through a long list.
    useEffect(() => {
        optionRefs.current[highlight]?.scrollIntoView({ block: 'nearest' });
    }, [highlight]);

    const isInside = (target: Node) =>
        !!(panelRef.current?.contains(target) || inputRef.current?.contains(target));
    useDismissOnClickOutside(open, isInside, () => setOpen(false));

    const pick = (contact: PickedContact) => {
        onPick(contact);
        setQuery('');
        setOpen(false);
    };

    const clear = () => {
        onPick(null);
        setQuery('');
        setOpen(false);
        inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!open || results.length === 0) {
            if (e.key === 'ArrowDown') {
                setOpen(true);
                e.preventDefault();
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((i) => (i + 1) % results.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((i) => (i - 1 + results.length) % results.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const contact = results[highlight];
            if (contact) pick(contact);
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    const subtitle = (contact: PickedContact) =>
        [contact.company, contact.mobile || contact.phone].filter(Boolean).join(' · ');

    return (
        <Field label={m.fields.contact} htmlFor={inputId} error={error} hint={selected ? hint : undefined}>
            <div className="relative">
                <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                    ref={inputRef}
                    id={inputId}
                    type="text"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={handleKeyDown}
                    placeholder={selected ? selected.name : m.fields.contactPlaceholder}
                    aria-label={m.fields.contact}
                    className="w-full ps-8 pe-8 py-1.5 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
                />
                {selected && (
                    <button
                        type="button"
                        onClick={clear}
                        title={t.common.remove}
                        aria-label={t.common.remove}
                        className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}

                {open && (
                    <AnchoredDropdown anchorRef={inputRef} panelRef={panelRef} maxHeight={256}>
                        {loading ? (
                            <div className="p-3 text-center text-gray-500 text-sm">{t.common.loading}</div>
                        ) : results.length === 0 ? (
                            <div className="p-3 text-center text-gray-500 text-sm">{t.common.noResults}</div>
                        ) : (
                            results.map((contact, index) => (
                                <div
                                    key={contact.id}
                                    ref={(el) => { optionRefs.current[index] = el; }}
                                    onClick={() => pick(contact)}
                                    onMouseEnter={() => setHighlight(index)}
                                    className={`px-3 py-2 cursor-pointer border-b last:border-b-0 ${index === highlight ? 'bg-blue-50' : ''}`}
                                >
                                    <div className="font-medium text-gray-900 text-sm truncate">{contact.name}</div>
                                    <div className="text-xs text-gray-500 truncate">{subtitle(contact)}</div>
                                </div>
                            ))
                        )}
                    </AnchoredDropdown>
                )}
            </div>
        </Field>
    );
}
