'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

export type ShortLinkRow = {
    id: string;
    code: string;
    target_url: string;
    label: string | null;
    click_count: number;
    created_at: string;
    revoked_at: string | null;
};

type Props = {
    /** Optional line above the form, e.g. who else can see these links. */
    description?: string;
    placeholder?: string;
    fetchLinks: () => Promise<unknown>;
    createLink: (data: { target_url: string; label?: string }) => Promise<unknown>;
    revokeLink: (id: string) => Promise<unknown>;
};

function isShortLinkRowArray(value: unknown): value is ShortLinkRow[] {
    return Array.isArray(value);
}

function extractRows(result: unknown): ShortLinkRow[] {
    if (isShortLinkRowArray(result)) return result;
    if (result && typeof result === 'object' && isShortLinkRowArray((result as { data?: unknown }).data)) {
        return (result as { data: ShortLinkRow[] }).data;
    }
    return [];
}

/**
 * The form and table behind both shortener pages. The platform-admin page and the
 * tenant Settings page differ only in which endpoints they call and what the copy
 * says, so those are props and everything else lives here once. All of the
 * component's own chrome (column headers, button labels, empty state) is routed
 * through i18n so a bn/ms tenant on Task 12's Settings page doesn't see permanently
 * English table furniture; `description`/`placeholder` stay props since that copy is
 * legitimately per-page.
 */
export default function ShortLinkManager({
    description,
    placeholder,
    fetchLinks,
    createLink,
    revokeLink,
}: Props) {
    const { t } = useI18n();
    const m = t.components.shortLinkManager;

    const [links, setLinks] = useState<ShortLinkRow[]>([]);
    const [target, setTarget] = useState('');
    const [label, setLabel] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    /** Row id whose link was just copied, so only that row shows the tick. */
    const [copiedId, setCopiedId] = useState<string | null>(null);

    /**
     * Origin the short links live on, resolved after mount.
     *
     * The table used to render the bare `/s/<code>` path, which made the copy
     * button the only way to get a usable link off this screen — reading a code
     * out to someone, or selecting it by hand, produced something that goes
     * nowhere. So the full URL is shown.
     *
     * It comes from `window.location.origin` rather than an env var because that
     * is by definition the domain the user reached these links through, and it is
     * the same value the clipboard has always copied — one source of truth for
     * both. Held in state and set in an effect because `window` does not exist
     * during the server render; until it resolves the row falls back to the bare
     * path, so nothing flashes a wrong domain.
     */
    const [origin, setOrigin] = useState('');

    useEffect(() => {
        setOrigin(window.location.origin);
    }, []);

    const shortLinkUrl = (row: ShortLinkRow) => `${origin}/s/${row.code}`;

    /**
     * `navigator.clipboard` is undefined in an insecure context and can be
     * refused outright, so the failure is surfaced instead of leaving the user
     * believing they hold a link they don't.
     */
    const copyLink = async (row: ShortLinkRow) => {
        try {
            await navigator.clipboard.writeText(shortLinkUrl(row));
        } catch {
            toast.error(m.copyError);
            return;
        }
        setCopiedId(row.id);
        setTimeout(() => setCopiedId((current) => (current === row.id ? null : current)), 2000);
    };

    // Deliberately swallows its own failure rather than rejecting: this runs
    // unattended on mount and after every create/revoke, so an uncaught rejection
    // here was an unhandled-promise-rejection with nothing on screen to explain it
    // — and a caller like revoke() awaiting this would have mislabeled "the revoke
    // worked but the reload failed" as a revoke failure. `loadError` is the single
    // place that failure surfaces; it doesn't clear `links`, so a transient reload
    // failure after a successful load keeps showing the last known-good list
    // instead of wiping it out from under the user.
    const load = useCallback(async () => {
        try {
            const result = await fetchLinks();
            setLinks(extractRows(result));
            setLoadError(null);
        } catch (err: unknown) {
            setLoadError(err instanceof Error ? err.message : m.loadError);
        }
    }, [fetchLinks, m.loadError]);

    useEffect(() => {
        void load();
    }, [load]);

    const create = async () => {
        setError(null);
        setSaving(true);
        try {
            const trimmed = target.trim();
            await createLink(label.trim() ? { target_url: trimmed, label: label.trim() } : { target_url: trimmed });
            setTarget('');
            setLabel('');
            await load();
        } catch (err: unknown) {
            // The backend rejection names the rule that refused the URL, and that
            // reason is the only thing explaining why a link the user considers
            // fine was turned down. Inline on the field, never a toast.
            setError(err instanceof Error ? err.message : m.createError);
        } finally {
            setSaving(false);
        }
    };

    const revoke = async (id: string) => {
        try {
            await revokeLink(id);
        } catch (err: unknown) {
            // Unlike create()'s rejection, this isn't about a form field the user is
            // looking at — it's a row-level action failure, so it goes through the
            // global Toaster (per the house rule: field errors inline, everything
            // else through Toaster) rather than being swallowed or misrouted into the
            // create form's error slot. Deliberately returns without calling load():
            // if the revoke didn't happen, the list must keep showing the link as
            // still active rather than silently drifting out of sync with the backend.
            toast.error(err instanceof Error ? err.message : m.revokeError);
            return;
        }
        // Split from the try above on purpose: revokeLink() succeeding and the
        // follow-up reload failing are different failures. load() surfaces its own
        // failure via the inline `loadError` banner (it no longer throws), so a
        // reload hiccup right after a successful revoke no longer shows a
        // misleading "could not revoke the link" toast next to a row that actually
        // was revoked.
        await load();
    };

    return (
        <div className="space-y-4">
            {description && <p className="text-xs text-gray-600">{description}</p>}

            <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                <div className="flex flex-col gap-2 md:flex-row">
                    <div className="flex-1">
                        <input
                            value={target}
                            onChange={(e) => setTarget(e.target.value)}
                            placeholder={placeholder ?? m.defaultPlaceholder}
                            className="min-h-touch w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                    </div>
                    <input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder={m.labelPlaceholder}
                        className="min-h-touch rounded-lg border border-gray-200 px-3 py-2 text-sm md:w-56"
                    />
                    <button
                        onClick={() => void create()}
                        disabled={saving || !target.trim()}
                        className="min-h-touch rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {m.shorten}
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-start text-xs uppercase text-gray-500">
                        <tr>
                            <th className="p-3">{m.shortLinkColumn}</th>
                            <th className="p-3">{m.targetColumn}</th>
                            <th className="p-3 text-end">{m.clicksColumn}</th>
                            <th className="p-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {links.map((row) => (
                            <tr key={row.id} className="border-t border-gray-100">
                                <td className="p-3 font-medium text-gray-900">
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="break-all">{shortLinkUrl(row)}</span>
                                        {!row.revoked_at && (
                                            <button
                                                type="button"
                                                onClick={() => void copyLink(row)}
                                                aria-label={copiedId === row.id ? m.copiedAria : m.copyAria}
                                                title={copiedId === row.id ? m.copiedAria : m.copyAria}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                                            >
                                                {copiedId === row.id ? (
                                                    <Check className="h-4 w-4 text-emerald-600" />
                                                ) : (
                                                    <Copy className="h-4 w-4" />
                                                )}
                                            </button>
                                        )}
                                    </span>
                                    {row.revoked_at && <span className="ms-2 text-xs text-red-600">{m.revoked}</span>}
                                </td>
                                <td className="p-3 max-w-md truncate text-gray-600">{row.target_url}</td>
                                <td className="p-3 text-end text-gray-700">{row.click_count}</td>
                                <td className="p-3 text-end">
                                    {!row.revoked_at && (
                                        <button
                                            onClick={() => void revoke(row.id)}
                                            aria-label={m.revokeAria}
                                            className="text-gray-400 hover:text-red-600"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {/* A failed load and "you have no links yet" both render an
                            empty-looking table unless they're told apart — this row
                            always wins over the empty-state row below when a load has
                            failed, even if some rows from a prior successful load are
                            still showing above it. */}
                        {loadError && (
                            <tr>
                                <td colSpan={4} className="p-6 text-center text-sm text-red-600">
                                    <p>{loadError}</p>
                                    <button
                                        onClick={() => void load()}
                                        className="mt-2 text-xs font-semibold text-blue-600 hover:underline"
                                    >
                                        {m.retry}
                                    </button>
                                </td>
                            </tr>
                        )}
                        {!loadError && links.length === 0 && (
                            <tr>
                                <td colSpan={4} className="p-6 text-center text-sm text-gray-500">
                                    {m.empty}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
