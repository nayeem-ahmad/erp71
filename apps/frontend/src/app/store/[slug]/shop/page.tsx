'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle, Minus, Package, Plus, Search, ShoppingCart, User, X } from 'lucide-react';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface CustomerSession {
    access_token: string;
    customer: { id: string; name: string; email: string; phone: string };
}

const API_BASE =
    ((process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL) ||
        (process.env.NODE_ENV === 'production'
            ? 'https://erp71-backend.onrender.com'
            : 'http://localhost:4000')) + '/api/v1';

interface Product {
    id: string;
    name: string;
    selling_price: string | number;
    compare_at_price: string | number | null;
    image_url: string | null;
    stock_quantity: number;
    group_name?: string;
}

interface Category {
    id: string;
    name: string;
    count: number;
    image_url: string | null;
}

interface StorefrontData {
    tenant: {
        name: string;
        storefront_banner: string | null;
        loyalty_enabled: boolean;
        loyalty_earn_rate: number | null;
        loyalty_redeem_rate: number | null;
        loyalty_min_redeem: number | null;
    };
    categories: Category[];
    all_products: Product[];
}

interface CartItem {
    product: Product;
    quantity: number;
}

function toNumber(value: string | number | null | undefined) {
    return Number(value ?? 0);
}

function formatOptionalPrice(value: string | number | null | undefined) {
    return value === null || value === undefined ? null : formatBDT(toNumber(value));
}

export default function StorefrontShopPage() {
    const { t } = useI18n();
    const m = t.storefront.public;
    const shop = m.shop;
    const footer = m.footer;
    const p = m.placeholders;
    const params = useParams();
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const slug = params?.slug as string;

    const [data, setData] = useState<StorefrontData | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [session, setSession] = useState<CustomerSession | null>(null);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);

    const [cart, setCart] = useState<CartItem[]>([]);
    const [cartOpen, setCartOpen] = useState(false);
    const [checkoutOpen, setCheckoutOpen] = useState(false);

    const [customerName, setCustomerName] = useState('');
    const [customerEmail, setCustomerEmail] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
    const [orderError, setOrderError] = useState<string | null>(null);

    const [loyaltyPoints, setLoyaltyPoints] = useState<number>(0);
    const [applyPoints, setApplyPoints] = useState(false);

    useEffect(() => {
        if (!slug) return;

        let token: string | null = null;
        try {
            const raw = localStorage.getItem(`storefront_customer_${slug}`);
            if (raw) {
                const parsed: CustomerSession = JSON.parse(raw);
                setSession(parsed);
                setCustomerName(parsed.customer.name);
                setCustomerEmail(parsed.customer.email);
                setCustomerPhone(parsed.customer.phone);
                token = parsed.access_token;
            }
        } catch {
            // ignore
        }

        const storefrontHeaders: Record<string, string> = {};
        if (token) storefrontHeaders.Authorization = `Bearer ${token}`;

        fetch(`${API_BASE}/storefront/${slug}`, { headers: storefrontHeaders })
            .then(async (response) => {
                if (!response.ok) {
                    setNotFound(true);
                    return;
                }

                const json = await response.json();
                setData('data' in json ? json.data : json);
            })
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));

        if (token) {
            fetch(`${API_BASE}/storefront/${slug}/customer/me`, {
                headers: { Authorization: `Bearer ${token}` },
            })
                .then((r) => r.json())
                .then((json) => {
                    const profile = 'data' in json ? json.data : json;
                    if (typeof profile?.loyalty_points === 'number') setLoyaltyPoints(profile.loyalty_points);
                })
                .catch(() => {});
        }
    }, [slug]);

    const handleSignOut = () => {
        localStorage.removeItem(`storefront_customer_${slug}`);
        setSession(null);
        setCustomerName('');
        setCustomerEmail('');
        setCustomerPhone('');
        setLoyaltyPoints(0);
        setApplyPoints(false);
        setAccountMenuOpen(false);
    };

    const sortOption = useMemo(() => {
        const sortParam = searchParams.get('sort');
        if (
            sortParam === 'price_asc'
            || sortParam === 'price_desc'
            || sortParam === 'name_asc'
            || sortParam === 'newest'
        ) {
            return sortParam;
        }
        return 'newest';
    }, [searchParams]);

    const searchQuery = searchParams.get('q') || '';

    const availableCategories = useMemo(() => {
        if (!data) return [];

        const categoryNameSet = new Set<string>();
        data.categories.forEach((category) => categoryNameSet.add(category.name));
        data.all_products.forEach((product) => {
            if (product.group_name) {
                categoryNameSet.add(product.group_name);
            }
        });

        return ['ALL', ...Array.from(categoryNameSet)];
    }, [data]);

    const computedMaxPrice = useMemo(() => {
        if (!data || data.all_products.length === 0) return 0;
        return data.all_products.reduce((max, product) => {
            const currentPrice = toNumber(product.selling_price);
            return Math.max(currentPrice, max);
        }, 0);
    }, [data]);

    const activeCategoryFilter = useMemo(() => {
        if (!data) return 'ALL';

        const categoryParam = searchParams.get('category');
        if (!categoryParam) return 'ALL';

        const selectedCategory = data.categories.find((category) => category.id === categoryParam);
        if (selectedCategory) {
            return selectedCategory.name;
        }

        return categoryParam;
    }, [data, searchParams]);

    const maxPriceFilter = useMemo(() => {
        const maxParam = searchParams.get('max');
        const parsed = maxParam ? Number(maxParam) : Number.NaN;

        if (Number.isFinite(parsed) && parsed >= 0) {
            return computedMaxPrice > 0 ? Math.min(parsed, computedMaxPrice) : parsed;
        }

        return computedMaxPrice;
    }, [computedMaxPrice, searchParams]);

    const updateQueryParams = (updates: Record<string, string | null>) => {
        const nextParams = new URLSearchParams(searchParams.toString());

        Object.entries(updates).forEach(([key, value]) => {
            if (!value) {
                nextParams.delete(key);
                return;
            }
            nextParams.set(key, value);
        });

        const nextQuery = nextParams.toString();
        router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    };

    const visibleProducts = useMemo(() => {
        if (!data) return [];

        let filteredProducts = data.all_products;

        if (activeCategoryFilter !== 'ALL') {
            filteredProducts = filteredProducts.filter((product) => product.group_name === activeCategoryFilter);
        }

        if (searchQuery.trim().length > 0) {
            const normalizedQuery = searchQuery.toLowerCase();
            filteredProducts = filteredProducts.filter((product) => {
                const productName = product.name.toLowerCase();
                const groupName = (product.group_name || '').toLowerCase();
                return productName.includes(normalizedQuery) || groupName.includes(normalizedQuery);
            });
        }

        filteredProducts = filteredProducts.filter((product) => toNumber(product.selling_price) <= maxPriceFilter);

        if (sortOption === 'price_asc') {
            return [...filteredProducts].sort((a, b) => toNumber(a.selling_price) - toNumber(b.selling_price));
        }

        if (sortOption === 'price_desc') {
            return [...filteredProducts].sort((a, b) => toNumber(b.selling_price) - toNumber(a.selling_price));
        }

        if (sortOption === 'name_asc') {
            return [...filteredProducts].sort((a, b) => a.name.localeCompare(b.name));
        }

        return filteredProducts;
    }, [activeCategoryFilter, data, maxPriceFilter, searchQuery, sortOption]);

    const addToCart = (product: Product) => {
        setCart((prev) => {
            const existing = prev.find((item) => item.product.id === product.id);

            if (existing) {
                return prev.map((item) =>
                    item.product.id === product.id
                        ? { ...item, quantity: Math.min(item.quantity + 1, product.stock_quantity) }
                        : item,
                );
            }

            return [...prev, { product, quantity: 1 }];
        });
    };

    const removeFromCart = (productId: string) => {
        setCart((prev) => prev.filter((item) => item.product.id !== productId));
    };

    const updateQty = (productId: string, delta: number) => {
        setCart((prev) =>
            prev
                .map((item) =>
                    item.product.id === productId
                        ? { ...item, quantity: item.quantity + delta }
                        : item,
                )
                .filter((item) => item.quantity > 0),
        );
    };

    const cartTotal = cart.reduce((total, item) => total + toNumber(item.product.selling_price) * item.quantity, 0);
    const cartCount = cart.reduce((count, item) => count + item.quantity, 0);

    const redeemRate = data?.tenant.loyalty_redeem_rate ?? 0;
    const minRedeem = data?.tenant.loyalty_min_redeem ?? 0;
    const loyaltyEligible =
        !!session &&
        !!data?.tenant.loyalty_enabled &&
        loyaltyPoints > 0 &&
        loyaltyPoints >= minRedeem;
    const pointsDiscount = applyPoints && loyaltyEligible
        ? Math.min(loyaltyPoints * redeemRate, cartTotal)
        : 0;
    const finalTotal = cartTotal - pointsDiscount;

    const handleCheckout = async (event: React.SyntheticEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        setOrderError(null);

        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

            const response = await fetch(`${API_BASE}/storefront/${slug}/orders`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    customerName,
                    customerEmail,
                    customerPhone: customerPhone || undefined,
                    notes: notes || undefined,
                    pointsToRedeem: applyPoints && loyaltyEligible ? loyaltyPoints : undefined,
                    items: cart.map((item) => ({
                        productId: item.product.id,
                        quantity: item.quantity,
                    })),
                }),
            });

            const json = await response.json();

            if (!response.ok) {
                throw new Error(json.message || m.orderFailed);
            }

            setOrderSuccess(json.data?.id || json.id || 'SUCCESS');
            setCart([]);
            setCheckoutOpen(false);
            setApplyPoints(false);
            if (!session) {
                setCustomerName('');
                setCustomerEmail('');
                setCustomerPhone('');
            }
            setNotes('');
            if (session?.access_token) {
                fetch(`${API_BASE}/storefront/${slug}/customer/me`, {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                })
                    .then((r) => r.json())
                    .then((j) => {
                        const p = 'data' in j ? j.data : j;
                        if (typeof p?.loyalty_points === 'number') setLoyaltyPoints(p.loyalty_points);
                    })
                    .catch(() => {});
            }
        } catch (err: any) {
            setOrderError(err.message || m.checkoutError);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="flex flex-col items-center space-y-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
                    <p className="text-gray-500 font-medium">{m.loading}</p>
                </div>
            </div>
        );
    }

    if (notFound || !data) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center space-y-4">
                    <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto">
                        <AlertCircle className="w-8 h-8 text-gray-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-800">{m.notFound.title}</h1>
                    <p className="text-gray-500">{m.notFound.description}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white text-gray-900 selection:bg-black selection:text-white">
            {data.tenant.storefront_banner && (
                <div className="bg-black text-white text-center py-2 px-4 text-sm tracking-wide">
                    {data.tenant.storefront_banner}
                </div>
            )}

            <header className="border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-md z-40">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-20 gap-6">
                        <Link href={`/store/${slug}`} className="text-2xl font-black tracking-tighter">
                            {data.tenant.name}
                        </Link>

                        <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
                            <Link href={`/store/${slug}`} className="text-gray-500 hover:text-gray-900 transition-colors">{m.nav.home}</Link>
                            <Link href={`/store/${slug}/shop`} className="text-gray-900 hover:text-gray-600 transition-colors">{m.nav.shop}</Link>
                            <a href="#contact" className="text-gray-500 hover:text-gray-900 transition-colors">{m.nav.contact}</a>
                        </nav>

                        <div className="flex items-center gap-2">
                            {session ? (
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setAccountMenuOpen((v) => !v)}
                                        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
                                    >
                                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-900 text-white text-xs font-bold">
                                            {session.customer.name.charAt(0).toUpperCase()}
                                        </span>
                                        <span className="hidden sm:block">{session.customer.name.split(' ')[0]}</span>
                                    </button>
                                    {accountMenuOpen && (
                                        <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                                            <p className="px-4 py-2 text-xs text-gray-400 truncate">{session.customer.email}</p>
                                            <hr className="border-gray-100" />
                                            <button
                                                type="button"
                                                onClick={handleSignOut}
                                                className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                                            >
                                                {m.signOut}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <Link
                                    href={`/store/${slug}/auth/signin`}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                                >
                                    <User className="w-4 h-4" />
                                    <span className="hidden sm:block">{m.signIn}</span>
                                </Link>
                            )}

                            <button
                                type="button"
                                onClick={() => setCartOpen(true)}
                                className="relative inline-flex items-center justify-center p-2 text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
                            >
                                <ShoppingCart className="w-6 h-6" />
                                {cartCount > 0 && (
                                    <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-5 h-5 px-1 text-[10px] font-bold text-white bg-blue-600 rounded-full">
                                        {cartCount}
                                    </span>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {orderSuccess && (
                <div className="max-w-7xl mx-auto mt-6 px-4 sm:px-6 lg:px-8">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start space-x-3">
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-green-800">{m.orderSuccess}</p>
                            <p className="text-green-700 text-sm mt-0.5">
                                {m.orderIdLabel} <span className="font-mono font-bold">{orderSuccess}</span>
                            </p>
                            <button
                                type="button"
                                onClick={() => setOrderSuccess(null)}
                                className="text-xs text-green-600 underline mt-1 font-medium hover:text-green-800"
                            >
                                {m.dismiss}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <main className="py-14 sm:py-16">
                <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="mb-8">
                        <h1 className="text-4xl sm:text-5xl font-black tracking-tight">{shop.title}</h1>
                        <p className="text-gray-500 mt-2">
                            {activeCategoryFilter === 'ALL' ? shop.browseAll : formatMessage(shop.browsingCategory, { category: activeCategoryFilter })}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8 items-start">
                        <aside className="bg-gray-50 border border-gray-200 rounded-2xl p-6 lg:sticky lg:top-28 space-y-7">
                            <div>
                                <h2 className="text-xl font-bold">{shop.filters}</h2>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">{m.categories}</h3>
                                <div className="space-y-2.5">
                                    {availableCategories.map((category) => {
                                        const isActive = activeCategoryFilter === category;
                                        return (
                                            <button
                                                key={category}
                                                type="button"
                                                onClick={() => {
                                                    if (category === 'ALL') {
                                                        updateQueryParams({ category: null });
                                                        return;
                                                    }

                                                    const matchedCategory = data.categories.find((item) => item.name === category);
                                                    updateQueryParams({ category: matchedCategory?.id || category });
                                                }}
                                                className="flex w-full items-center gap-2 text-left"
                                            >
                                                <span className={`inline-flex w-4 h-4 rounded-full border ${isActive ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-white'}`} />
                                                <span className={`text-sm ${isActive ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}>
                                                    {category === 'ALL' ? shop.all : category}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">{shop.priceRange}</h3>
                                <input
                                    type="range"
                                    min={0}
                                    max={Math.max(Math.ceil(computedMaxPrice), 1)}
                                    value={Math.min(maxPriceFilter, Math.max(Math.ceil(computedMaxPrice), 1))}
                                    onChange={(event) => {
                                        const nextValue = Number(event.target.value);
                                        const resetValue = Math.max(Math.ceil(computedMaxPrice), 1);
                                        updateQueryParams({
                                            max: nextValue >= resetValue ? null : String(nextValue),
                                        });
                                    }}
                                    className="w-full accent-blue-600"
                                />
                                <div className="flex items-center justify-between text-sm font-medium text-gray-500">
                                    <span>{formatBDT(0)}</span>
                                    <span>{formatBDT(maxPriceFilter)}</span>
                                </div>
                            </div>
                        </aside>

                        <div>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                                <p className="text-sm text-gray-500">
                                    {visibleProducts.length === 1
                                        ? formatMessage(shop.showingProducts, { count: visibleProducts.length })
                                        : formatMessage(shop.showingProductsPlural, { count: visibleProducts.length })}
                                </p>

                                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                                    <label htmlFor="shop-search" className="relative block">
                                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            id="shop-search"
                                            type="search"
                                            placeholder={shop.searchPlaceholder}
                                            value={searchQuery}
                                            onChange={(event) => updateQueryParams({ q: event.target.value.trim() ? event.target.value : null })}
                                            className="h-11 w-full sm:w-64 rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                                        />
                                    </label>

                                    <select
                                        value={sortOption}
                                        onChange={(event) => updateQueryParams({ sort: event.target.value === 'newest' ? null : event.target.value })}
                                        className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                    >
                                        <option value="newest">{shop.sort.newest}</option>
                                        <option value="price_asc">{shop.sort.priceAsc}</option>
                                        <option value="price_desc">{shop.sort.priceDesc}</option>
                                        <option value="name_asc">{shop.sort.nameAsc}</option>
                                    </select>
                                </div>
                            </div>

                            {visibleProducts.length === 0 ? (
                                <div className="text-center py-16 text-gray-400 border border-dashed border-gray-200 rounded-2xl">
                                    <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                                    <p className="text-lg font-medium">{shop.noFilteredProducts}</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                                    {visibleProducts.map((product) => {
                                        const price = toNumber(product.selling_price);
                                        const comparePrice = toNumber(product.compare_at_price);
                                        const onSale = comparePrice > price;

                                        return (
                                            <article key={product.id} className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-shadow border border-gray-100 overflow-hidden flex flex-col">
                                                <div className="relative aspect-[4/5] bg-gray-100 overflow-hidden">
                                                    {product.image_url ? (
                                                        <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                                                            <Package className="w-12 h-12 text-gray-300" />
                                                        </div>
                                                    )}

                                                    {onSale && (
                                                        <div className="absolute top-4 left-4 bg-white text-black text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
                                                            {m.sale}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="p-5 flex flex-col flex-1">
                                                    <div className="text-sm text-gray-500 mb-1.5 font-medium">{product.group_name || m.categoryFallback}</div>
                                                    <h3 className="font-semibold text-gray-900 leading-snug mb-3">{product.name}</h3>
                                                    <div className="flex items-center gap-2 mt-auto pt-2 border-t border-gray-50">
                                                        <span className="font-black text-lg">{formatBDT(price)}</span>
                                                        {onSale && (
                                                            <span className="text-sm text-gray-400 line-through">{formatOptionalPrice(product.compare_at_price)}</span>
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => addToCart(product)}
                                                        disabled={product.stock_quantity <= 0}
                                                        className="mt-4 inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 transition-colors disabled:bg-gray-300"
                                                    >
                                                        {product.stock_quantity > 0 ? m.addToCart : m.outOfStock}
                                                    </button>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            </main>

            <footer id="contact" className="bg-gray-900 text-white py-12 mt-16">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-sm text-gray-400 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <p>{formatMessage(footer.allRightsReserved, { year: new Date().getFullYear(), name: data.tenant.name })}</p>
                    <Link href={`/store/${slug}`} className="text-white hover:text-gray-200 transition-colors">
                        {footer.backToHome}
                    </Link>
                </div>
            </footer>

            {cartOpen && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <button
                        type="button"
                        aria-label={m.closeCartOverlayAria}
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setCartOpen(false)}
                    />
                    <aside className="relative w-full max-w-md bg-white h-full flex flex-col shadow-2xl">
                        <div className="flex items-center justify-between p-6 border-b border-gray-100">
                            <h2 className="text-xl font-bold flex items-center space-x-2">
                                <ShoppingCart className="w-5 h-5" />
                                <span>{formatMessage(m.yourCart, { count: cartCount })}</span>
                            </h2>
                            <button type="button" onClick={() => setCartOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {cart.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
                                    <ShoppingCart className="w-16 h-16 opacity-20" />
                                    <p className="text-lg">{m.emptyCart}</p>
                                    <button
                                        type="button"
                                        onClick={() => setCartOpen(false)}
                                        className="mt-4 border border-gray-300 text-gray-600 hover:bg-gray-50 px-6 py-2 rounded-full font-medium transition-colors"
                                    >
                                        {m.continueShopping}
                                    </button>
                                </div>
                            ) : (
                                <ul className="space-y-6">
                                    {cart.map((item) => (
                                        <li key={item.product.id} className="flex space-x-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                            {item.product.image_url ? (
                                                <img src={item.product.image_url} alt={item.product.name} className="w-20 h-20 rounded-lg object-cover bg-gray-50" />
                                            ) : (
                                                <div className="w-20 h-20 bg-gray-50 rounded-lg flex items-center justify-center border border-gray-100">
                                                    <Package className="w-8 h-8 text-gray-300" />
                                                </div>
                                            )}
                                            <div className="flex-1 flex flex-col">
                                                <div className="flex justify-between items-start">
                                                    <h3 className="font-semibold text-gray-900 leading-tight pr-4">{item.product.name}</h3>
                                                    <button type="button" onClick={() => removeFromCart(item.product.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                                <p className="text-sm font-bold text-gray-900 mt-1">{formatBDT(toNumber(item.product.selling_price))}</p>
                                                <div className="mt-auto pt-3 flex items-center space-x-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => updateQty(item.product.id, -1)}
                                                        className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-full transition-colors text-gray-600"
                                                    >
                                                        <Minus className="w-3 h-3" />
                                                    </button>
                                                    <span className="text-sm font-semibold w-4 text-center">{item.quantity}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateQty(item.product.id, 1)}
                                                        disabled={item.quantity >= item.product.stock_quantity}
                                                        className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-full transition-colors text-gray-600 disabled:opacity-50 disabled:hover:bg-gray-100"
                                                    >
                                                        <Plus className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {cart.length > 0 && (
                            <div className="p-6 bg-gray-50 border-t border-gray-100 space-y-4">
                                <div className="flex justify-between items-center text-lg font-bold">
                                    <span>{m.subtotal}</span>
                                    <span>{formatBDT(cartTotal)}</span>
                                </div>
                                <p className="text-sm text-gray-500 text-center">{m.shippingNote}</p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCartOpen(false);
                                        setCheckoutOpen(true);
                                    }}
                                    className="w-full bg-black hover:bg-gray-800 text-white font-bold py-4 rounded-xl transition-colors shadow-lg shadow-black/10"
                                >
                                    {m.proceedToCheckout}
                                </button>
                            </div>
                        )}
                    </aside>
                </div>
            )}

            {checkoutOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <button
                        type="button"
                        aria-label={m.closeCheckoutOverlayAria}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={() => setCheckoutOpen(false)}
                    />
                    <div className="relative bg-white rounded-2xl w-full max-w-lg z-10 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                            <h2 className="text-xl font-bold tracking-tight">{m.checkout}</h2>
                            <button type="button" onClick={() => setCheckoutOpen(false)} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1">
                            <form id="checkout-form" onSubmit={handleCheckout} className="p-6 space-y-5">
                                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">{m.orderSummary}</h3>
                                    <div className="space-y-2">
                                        {cart.map((item) => (
                                            <div key={item.product.id} className="flex justify-between text-sm text-gray-700 gap-4">
                                                <span className="flex-1 pr-4 truncate">
                                                    {item.quantity} × {item.product.name}
                                                </span>
                                                <span className="font-semibold whitespace-nowrap">
                                                    {formatBDT(toNumber(item.product.selling_price) * item.quantity)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="border-t border-gray-200 mt-3 pt-3 space-y-1">
                                        {pointsDiscount > 0 && (
                                            <div className="flex justify-between text-sm text-green-700">
                                                <span>{m.pointsDiscount}</span>
                                                <span>-{formatBDT(pointsDiscount)}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between text-base font-bold text-gray-900">
                                            <span>{m.total}</span>
                                            <span className="text-blue-600">{formatBDT(finalTotal)}</span>
                                        </div>
                                    </div>
                                </div>

                                {loyaltyEligible && (
                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={applyPoints}
                                                onChange={(e) => setApplyPoints(e.target.checked)}
                                                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-amber-500"
                                            />
                                            <div className="text-sm">
                                                <p className="font-semibold text-amber-800">
                                                    {formatMessage(m.useLoyaltyPoints, { points: loyaltyPoints })}
                                                </p>
                                                <p className="text-amber-700 mt-0.5">
                                                    {formatMessage(m.pointsWorth, { amount: formatBDT(Math.min(loyaltyPoints * redeemRate, cartTotal)) })}
                                                </p>
                                            </div>
                                        </label>
                                    </div>
                                )}

                                {session && data?.tenant.loyalty_enabled && data.tenant.loyalty_earn_rate && !loyaltyEligible && (
                                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                                        🏆 {formatMessage(m.earnPoints, { points: Math.floor(finalTotal * data.tenant.loyalty_earn_rate) })}
                                    </p>
                                )}

                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mt-6 mb-2">{m.customerDetails}</h3>

                                    <div>
                                        <label htmlFor="customer-name" className="block text-sm font-semibold text-gray-700 mb-1.5">{m.fullName} <span className="text-red-500">*</span></label>
                                        <input
                                            id="customer-name"
                                            type="text"
                                            required
                                            value={customerName}
                                            onChange={(event) => setCustomerName(event.target.value)}
                                            placeholder={p.name}
                                            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="customer-email" className="block text-sm font-semibold text-gray-700 mb-1.5">{m.email} <span className="text-red-500">*</span></label>
                                        <input
                                            id="customer-email"
                                            type="email"
                                            required
                                            value={customerEmail}
                                            onChange={(event) => setCustomerEmail(event.target.value)}
                                            placeholder={p.email}
                                            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="customer-phone" className="block text-sm font-semibold text-gray-700 mb-1.5">{m.phoneOptional}</label>
                                        <input
                                            id="customer-phone"
                                            type="tel"
                                            value={customerPhone}
                                            onChange={(event) => setCustomerPhone(event.target.value)}
                                            placeholder={p.phone}
                                            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="delivery-notes" className="block text-sm font-semibold text-gray-700 mb-1.5">{m.deliveryNotesOptional}</label>
                                        <textarea
                                            id="delivery-notes"
                                            value={notes}
                                            onChange={(event) => setNotes(event.target.value)}
                                            placeholder={p.deliveryNotes}
                                            rows={2}
                                            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all resize-none"
                                        />
                                    </div>
                                </div>
                            </form>
                        </div>

                        <div className="p-6 border-t border-gray-100 bg-white">
                            {orderError && (
                                <p className="text-red-600 text-sm bg-red-50 rounded-lg px-4 py-3 mb-4 flex items-center space-x-2">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    <span>{orderError}</span>
                                </p>
                            )}

                            <button
                                type="submit"
                                form="checkout-form"
                                disabled={submitting}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-colors disabled:opacity-60 shadow-lg shadow-blue-600/20 text-lg"
                            >
                                {submitting ? m.processing : formatMessage(m.payAmount, { amount: formatBDT(finalTotal) })}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
