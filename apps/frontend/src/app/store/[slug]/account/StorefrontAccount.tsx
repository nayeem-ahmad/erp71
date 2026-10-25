'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle, ChevronDown, ChevronUp, Package } from 'lucide-react';
import { storefrontOrderRef, type StorefrontOrderStatus } from '@erp71/shared-types';
import StorefrontHeader from '@/components/storefront/StorefrontHeader';
import { storefrontTheme, storefrontThemeStyle } from '@/lib/storefront/storefront-theme';
import type { StorefrontMeta } from '@/lib/storefront/storefront-meta';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { browserApiBase } from '@/lib/api-base';

const API_BASE = browserApiBase();
const PAGE_SIZE = 10;

interface CustomerSession {
    access_token: string;
    customer: { id: string; name: string; email: string; phone: string | null };
}

interface Profile {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    loyalty_points: number;
    total_spent: string | number;
}

interface AccountOrder {
    id: string;
    status: StorefrontOrderStatus;
    totalAmount: string | number;
    notes: string | null;
    deliveryAddress: string | null;
    deliveryArea: string | null;
    created_at: string;
    items: {
        id: string;
        quantity: number;
        priceAtOrder: string | number;
        product: { id: string; name: string; image_url: string | null } | null;
    }[];
}

const STATUS_STYLES: Record<StorefrontOrderStatus, string> = {
    PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
    CONFIRMED: 'bg-blue-50 text-blue-700 border-blue-200',
    SHIPPED: 'bg-blue-50 text-blue-700 border-blue-200',
    DELIVERED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

const inputCls =
    'w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all';

/** The backend wraps every success in `{ data }`; older handlers did not. */
function unwrap<T>(json: any): T {
    return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
}

function sessionKey(slug: string) {
    return `storefront_customer_${slug}`;
}

export default function StorefrontAccount({ slug, shop }: { slug: string; shop: StorefrontMeta | null }) {
    const { t, fmt, locale } = useI18n();
    const m = t.storefront.public;
    const a = m.account;
    const router = useRouter();

    const [session, setSession] = useState<CustomerSession | null>(null);
    // False until localStorage has been read, so a signed-in shopper never sees
    // the sign-in prompt flash before their account appears.
    const [sessionChecked, setSessionChecked] = useState(false);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);

    const [profile, setProfile] = useState<Profile | null>(null);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [address, setAddress] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

    const [orders, setOrders] = useState<AccountOrder[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loadingOrders, setLoadingOrders] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [loadError, setLoadError] = useState(false);

    /** A rejected token means the session is over — drop it and show the sign-in prompt. */
    const endSession = useCallback(() => {
        try {
            localStorage.removeItem(sessionKey(slug));
        } catch {
            // ignore
        }
        setSession(null);
    }, [slug]);

    const authFetch = useCallback(
        async (path: string, token: string, init: RequestInit = {}) => {
            const response = await fetch(`${API_BASE}/storefront/${slug}${path}`, {
                ...init,
                headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
            });
            if (response.status === 401) {
                endSession();
                throw new Error('unauthorized');
            }
            const json = await response.json().catch(() => null);
            if (!response.ok) throw new Error(json?.error?.message || json?.message || a.loadFailed);
            return unwrap<any>(json);
        },
        [slug, endSession, a.loadFailed],
    );

    const loadOrders = useCallback(
        async (token: string, nextPage: number) => {
            setLoadingOrders(true);
            try {
                const result = await authFetch(`/customer/orders?page=${nextPage}&limit=${PAGE_SIZE}`, token);
                setOrders((previous) => (nextPage === 1 ? result.items : [...previous, ...result.items]));
                setPage(nextPage);
                setPages(result.pages ?? 1);
            } finally {
                setLoadingOrders(false);
            }
        },
        [authFetch],
    );

    useEffect(() => {
        let stored: CustomerSession | null = null;
        try {
            const raw = localStorage.getItem(sessionKey(slug));
            if (raw) stored = JSON.parse(raw);
        } catch {
            // ignore
        }
        setSession(stored);
        setSessionChecked(true);
        if (!stored) return;

        authFetch('/customer/me', stored.access_token)
            .then((result: Profile) => {
                setProfile(result);
                setName(result.name ?? '');
                setPhone(result.phone ?? '');
                setAddress(result.address ?? '');
            })
            .catch((err) => {
                if (err.message !== 'unauthorized') setLoadError(true);
            });
        loadOrders(stored.access_token, 1).catch((err) => {
            if (err.message !== 'unauthorized') setLoadError(true);
        });
    }, [slug, authFetch, loadOrders]);

    const handleSignOut = () => {
        if (session?.access_token) {
            fetch(`${API_BASE}/storefront/${slug}/auth/logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${session.access_token}` },
            }).catch(() => {});
        }
        endSession();
        router.push(`/store/${slug}`);
    };

    const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!session) return;
        setSaving(true);
        setSaveMessage(null);
        try {
            const updated: Profile = await authFetch('/customer/me', session.access_token, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), phone: phone.trim(), address: address.trim() }),
            });
            setProfile(updated);
            setName(updated.name ?? '');
            setPhone(updated.phone ?? '');
            setAddress(updated.address ?? '');
            // Keep the header and checkout prefill in step with what was saved.
            const nextSession = {
                ...session,
                customer: { ...session.customer, name: updated.name, phone: updated.phone },
            };
            setSession(nextSession);
            try {
                localStorage.setItem(sessionKey(slug), JSON.stringify(nextSession));
            } catch {
                // ignore
            }
            setSaveMessage({ tone: 'success', text: a.saved });
        } catch (err: any) {
            if (err.message !== 'unauthorized') {
                setSaveMessage({ tone: 'error', text: err.message || a.saveFailed });
            }
        } finally {
            setSaving(false);
        }
    };

    const toggleExpanded = (orderId: string) =>
        setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(orderId)) next.delete(orderId);
            else next.add(orderId);
            return next;
        });

    const statusLabel = (status: StorefrontOrderStatus) =>
        a.status[status.toLowerCase() as keyof typeof a.status] ?? status;

    const storeName = shop?.name || m.storeFallback;

    return (
        <div
            className="min-h-screen bg-gray-50 text-gray-900"
            style={storefrontThemeStyle(storefrontTheme(shop?.brand_primary_color))}
        >
            <StorefrontHeader
                slug={slug}
                storeName={storeName}
                logoUrl={shop?.storefront_logo}
                showStoreName={shop?.storefront_logo_show_name ?? true}
                activeNav="account"
                session={session}
                accountMenuOpen={accountMenuOpen}
                onAccountMenuToggle={() => setAccountMenuOpen((value) => !value)}
                onSignOut={handleSignOut}
                cartCount={0}
                onCartOpen={() => router.push(`/store/${slug}/shop`)}
            />

            <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{a.title}</h1>
                    <p className="text-sm text-gray-500 mt-1">{a.subtitle}</p>
                </div>

                {!sessionChecked ? null : !session ? (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center space-y-4">
                        <p className="text-gray-600">{a.signInPrompt}</p>
                        <Link
                            href={`/store/${slug}/auth/signin`}
                            className="inline-flex items-center justify-center min-h-11 px-6 bg-black hover:bg-gray-800 text-white font-semibold rounded-xl transition-colors"
                        >
                            {m.signIn}
                        </Link>
                    </div>
                ) : (
                    <>
                        {loadError && (
                            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <span>{a.loadFailed}</span>
                            </div>
                        )}

                        {profile && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                                    <p className="text-xs font-medium text-gray-500">{a.loyaltyPoints}</p>
                                    <p className="text-xl font-bold mt-1">{profile.loyalty_points}</p>
                                </div>
                                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                                    <p className="text-xs font-medium text-gray-500">{a.totalSpent}</p>
                                    <p className="text-xl font-bold mt-1">{formatBDT(Number(profile.total_spent ?? 0))}</p>
                                </div>
                            </div>
                        )}

                        <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                            <h2 className="text-lg font-bold mb-4">{a.details}</h2>
                            <form onSubmit={handleSave} className="space-y-4">
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="account-name" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            {m.fullName}
                                        </label>
                                        <input
                                            id="account-name"
                                            type="text"
                                            required
                                            maxLength={120}
                                            autoComplete="name"
                                            value={name}
                                            onChange={(event) => setName(event.target.value)}
                                            className={inputCls}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="account-email" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            {m.email}
                                        </label>
                                        <input
                                            id="account-email"
                                            type="email"
                                            readOnly
                                            value={profile?.email ?? session.customer.email ?? ''}
                                            className={`${inputCls} bg-gray-50 text-gray-500`}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="account-phone" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            {m.phoneOptional}
                                        </label>
                                        <input
                                            id="account-phone"
                                            type="tel"
                                            maxLength={30}
                                            autoComplete="tel"
                                            value={phone}
                                            onChange={(event) => setPhone(event.target.value)}
                                            placeholder={m.placeholders.phone}
                                            className={inputCls}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="account-address" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            {a.address}
                                        </label>
                                        <input
                                            id="account-address"
                                            type="text"
                                            maxLength={500}
                                            autoComplete="street-address"
                                            value={address}
                                            onChange={(event) => setAddress(event.target.value)}
                                            placeholder={m.placeholders.deliveryAddress}
                                            className={inputCls}
                                        />
                                    </div>
                                </div>

                                {saveMessage && (
                                    <p
                                        role={saveMessage.tone === 'error' ? 'alert' : 'status'}
                                        className={`flex items-center gap-2 text-sm ${
                                            saveMessage.tone === 'error' ? 'text-red-600' : 'text-emerald-700'
                                        }`}
                                    >
                                        {saveMessage.tone === 'error' ? (
                                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                        ) : (
                                            <CheckCircle className="w-4 h-4 flex-shrink-0" />
                                        )}
                                        {saveMessage.text}
                                    </p>
                                )}

                                <button
                                    type="submit"
                                    disabled={saving || !profile}
                                    className="min-h-11 px-6 bg-black hover:bg-gray-800 text-white font-semibold rounded-xl transition-colors disabled:opacity-60"
                                >
                                    {saving ? a.saving : a.save}
                                </button>
                            </form>
                        </section>

                        <section className="space-y-3">
                            <h2 className="text-lg font-bold">{a.ordersTitle}</h2>

                            {!loadingOrders && orders.length === 0 ? (
                                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center space-y-4">
                                    <Package className="w-10 h-10 mx-auto text-gray-300" />
                                    <p className="text-gray-500">{a.noOrders}</p>
                                    <Link
                                        href={`/store/${slug}/shop`}
                                        className="inline-flex items-center justify-center min-h-11 px-6 bg-[color:var(--sf-accent)] text-[color:var(--sf-accent-foreground)] font-semibold rounded-xl transition-opacity hover:opacity-90"
                                    >
                                        {a.startShopping}
                                    </Link>
                                </div>
                            ) : (
                                <ul className="space-y-3">
                                    {orders.map((order) => {
                                        const open = expanded.has(order.id);
                                        const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
                                        const deliverTo = [order.deliveryAddress, order.deliveryArea]
                                            .filter(Boolean)
                                            .join(', ');
                                        return (
                                            <li
                                                key={order.id}
                                                className="bg-white rounded-xl border border-gray-100 shadow-sm"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => toggleExpanded(order.id)}
                                                    aria-expanded={open}
                                                    aria-label={open ? a.hideDetails : a.showDetails}
                                                    className="w-full text-start p-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3 min-h-11"
                                                >
                                                    <div className="min-w-0">
                                                        <p className="font-semibold">
                                                            {fmt(a.orderRef, { ref: storefrontOrderRef(order.id) })}
                                                        </p>
                                                        <p className="text-xs text-gray-500 mt-0.5">
                                                            {fmt(a.placedOn, { date: formatDate(order.created_at, locale) })}
                                                            {' · '}
                                                            {fmt(a.itemCount, { count: itemCount })}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-3 flex-shrink-0 justify-between sm:justify-start">
                                                        <span
                                                            className={`text-xs font-semibold px-2 py-1 rounded-lg border ${
                                                                STATUS_STYLES[order.status]
                                                                ?? 'bg-gray-50 text-gray-700 border-gray-200'
                                                            }`}
                                                        >
                                                            {statusLabel(order.status)}
                                                        </span>
                                                        <span className="font-bold whitespace-nowrap">
                                                            {formatBDT(Number(order.totalAmount))}
                                                        </span>
                                                        {open ? (
                                                            <ChevronUp className="w-4 h-4 text-gray-400" />
                                                        ) : (
                                                            <ChevronDown className="w-4 h-4 text-gray-400" />
                                                        )}
                                                    </div>
                                                </button>

                                                {open && (
                                                    <div className="border-t border-gray-100 px-4 py-3 space-y-3 text-sm">
                                                        <ul className="space-y-1">
                                                            {order.items.map((item) => (
                                                                <li key={item.id} className="flex justify-between gap-4 text-gray-700">
                                                                    <span className="truncate">
                                                                        {item.quantity} × {item.product?.name ?? '—'}
                                                                    </span>
                                                                    <span className="whitespace-nowrap">
                                                                        {formatBDT(Number(item.priceAtOrder) * item.quantity)}
                                                                    </span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                        {deliverTo && (
                                                            <p className="text-gray-600">
                                                                <span className="font-semibold text-gray-700">{a.deliverTo}:</span>{' '}
                                                                {deliverTo}
                                                            </p>
                                                        )}
                                                        {order.notes && (
                                                            <p className="text-gray-600">
                                                                <span className="font-semibold text-gray-700">{a.notes}:</span>{' '}
                                                                {order.notes}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}

                            {page < pages && (
                                <button
                                    type="button"
                                    disabled={loadingOrders}
                                    onClick={() => session && loadOrders(session.access_token, page + 1).catch(() => setLoadError(true))}
                                    className="w-full min-h-11 border border-gray-200 bg-white hover:bg-gray-50 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
                                >
                                    {a.loadMore}
                                </button>
                            )}
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}
