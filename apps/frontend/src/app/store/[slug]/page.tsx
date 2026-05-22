'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ShoppingCart, X, Plus, Minus, Package, AlertCircle, CheckCircle } from 'lucide-react';
import { formatBDT } from '@/lib/format';

const API_BASE =
    (process.env.NEXT_PUBLIC_API_BASE ||
        (process.env.NODE_ENV === 'production'
            ? 'https://retail-saas-backend.onrender.com'
            : 'http://localhost:4000')) + '/api/v1';

interface Product {
    id: string;
    name: string;
    selling_price: string | number;
    image_url: string | null;
    stock_quantity: number;
}

interface StorefrontData {
    tenant: {
        name: string;
        storefront_banner: string | null;
    };
    products: Product[];
}

interface CartItem {
    product: Product;
    quantity: number;
}

export default function StorefrontPage() {
    const params = useParams();
    const slug = params?.slug as string;

    const [data, setData] = useState<StorefrontData | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [cart, setCart] = useState<CartItem[]>([]);
    const [cartOpen, setCartOpen] = useState(false);
    const [checkoutOpen, setCheckoutOpen] = useState(false);

    // Checkout form
    const [customerName, setCustomerName] = useState('');
    const [customerEmail, setCustomerEmail] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
    const [orderError, setOrderError] = useState<string | null>(null);

    useEffect(() => {
        if (!slug) return;
        fetch(`${API_BASE}/storefront/${slug}`)
            .then(async (res) => {
                if (!res.ok) {
                    setNotFound(true);
                    return;
                }
                const json = await res.json();
                setData('data' in json ? json.data : json);
            })
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
    }, [slug]);

    const addToCart = (product: Product) => {
        setCart((prev) => {
            const existing = prev.find((i) => i.product.id === product.id);
            if (existing) {
                return prev.map((i) =>
                    i.product.id === product.id
                        ? { ...i, quantity: Math.min(i.quantity + 1, product.stock_quantity) }
                        : i,
                );
            }
            return [...prev, { product, quantity: 1 }];
        });
    };

    const removeFromCart = (productId: string) => {
        setCart((prev) => prev.filter((i) => i.product.id !== productId));
    };

    const updateQty = (productId: string, delta: number) => {
        setCart((prev) =>
            prev
                .map((i) =>
                    i.product.id === productId
                        ? { ...i, quantity: i.quantity + delta }
                        : i,
                )
                .filter((i) => i.quantity > 0),
        );
    };

    const cartTotal = cart.reduce(
        (sum, i) => sum + Number(i.product.selling_price) * i.quantity,
        0,
    );
    const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);

    const handleCheckout = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!data) return;
        setSubmitting(true);
        setOrderError(null);
        try {
            const res = await fetch(`${API_BASE}/storefront/${slug}/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerName,
                    customerEmail,
                    customerPhone: customerPhone || undefined,
                    notes: notes || undefined,
                    items: cart.map((i) => ({
                        productId: i.product.id,
                        quantity: i.quantity,
                    })),
                }),
            });
            const json = await res.json();
            if (!res.ok) {
                const msg = Array.isArray(json?.message)
                    ? json.message.join(', ')
                    : json?.message || 'Failed to place order';
                throw new Error(msg);
            }
            const order = 'data' in json ? json.data : json;
            setOrderSuccess(order.id);
            setCart([]);
            setCheckoutOpen(false);
            setCartOpen(false);
        } catch (err: any) {
            setOrderError(err.message || 'Failed to place order');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
            </div>
        );
    }

    if (notFound || !data) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-center px-4">
                <AlertCircle className="w-16 h-16 text-gray-300 mb-4" />
                <h1 className="text-2xl font-bold text-gray-700 mb-2">Store Not Available</h1>
                <p className="text-gray-500">This store is not available or does not exist.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white shadow-sm sticky top-0 z-30">
                <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                            <Package className="w-5 h-5 text-white" />
                        </div>
                        <h1 className="text-xl font-bold tracking-tight">{data.tenant.name}</h1>
                    </div>
                    <button
                        onClick={() => setCartOpen(true)}
                        className="relative flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-semibold transition-colors"
                    >
                        <ShoppingCart className="w-5 h-5" />
                        <span>Cart</span>
                        {cartCount > 0 && (
                            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                                {cartCount}
                            </span>
                        )}
                    </button>
                </div>
            </header>

            {/* Banner */}
            {data.tenant.storefront_banner && (
                <div className="bg-blue-600 text-white text-center py-3 px-4 text-sm font-medium">
                    {data.tenant.storefront_banner}
                </div>
            )}

            {/* Success message */}
            {orderSuccess && (
                <div className="max-w-6xl mx-auto mt-6 px-4">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start space-x-3">
                        <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-emerald-800">Order placed successfully!</p>
                            <p className="text-emerald-700 text-sm mt-0.5">
                                Order ID: <span className="font-mono font-bold">{orderSuccess}</span>
                            </p>
                            <button
                                onClick={() => setOrderSuccess(null)}
                                className="text-xs text-emerald-600 underline mt-1"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Product Grid */}
            <main className="max-w-6xl mx-auto px-4 py-8">
                {data.products.length === 0 ? (
                    <div className="text-center py-16 text-gray-400">
                        <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p className="text-lg font-medium">No products available</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {data.products.map((product) => {
                            const cartItem = cart.find((i) => i.product.id === product.id);
                            const inCart = !!cartItem;
                            return (
                                <div
                                    key={product.id}
                                    className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow border border-gray-100 flex flex-col overflow-hidden"
                                >
                                    {product.image_url ? (
                                        <img
                                            src={product.image_url}
                                            alt={product.name}
                                            className="w-full h-44 object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-44 bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
                                            <Package className="w-12 h-12 text-blue-200" />
                                        </div>
                                    )}
                                    <div className="p-4 flex flex-col flex-1">
                                        <h3 className="font-semibold text-gray-900 leading-snug mb-1">
                                            {product.name}
                                        </h3>
                                        <div className="mt-auto pt-3 flex items-center justify-between">
                                            <div>
                                                <p className="text-lg font-bold text-gray-900">
                                                    {formatBDT(Number(product.selling_price))}
                                                </p>
                                                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                                                    {product.stock_quantity} in stock
                                                </span>
                                            </div>
                                            {inCart ? (
                                                <div className="flex items-center space-x-1">
                                                    <button
                                                        onClick={() => updateQty(product.id, -1)}
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                                                    >
                                                        <Minus className="w-3.5 h-3.5 text-gray-700" />
                                                    </button>
                                                    <span className="w-6 text-center text-sm font-bold text-gray-800">
                                                        {cartItem.quantity}
                                                    </span>
                                                    <button
                                                        onClick={() => updateQty(product.id, 1)}
                                                        disabled={cartItem.quantity >= product.stock_quantity}
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-blue-100 hover:bg-blue-200 transition-colors disabled:opacity-40"
                                                    >
                                                        <Plus className="w-3.5 h-3.5 text-blue-700" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => addToCart(product)}
                                                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                                                >
                                                    Add to Cart
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* Cart Sidebar */}
            {cartOpen && (
                <div className="fixed inset-0 z-40 flex justify-end">
                    <div
                        className="absolute inset-0 bg-black/40"
                        onClick={() => setCartOpen(false)}
                    />
                    <aside className="relative bg-white w-full max-w-sm h-full shadow-2xl flex flex-col z-50">
                        <div className="flex items-center justify-between px-5 py-4 border-b">
                            <h2 className="text-lg font-bold">Your Cart</h2>
                            <button onClick={() => setCartOpen(false)}>
                                <X className="w-5 h-5 text-gray-500 hover:text-gray-900" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                            {cart.length === 0 ? (
                                <div className="text-center py-12 text-gray-400">
                                    <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
                                    <p>Your cart is empty</p>
                                </div>
                            ) : (
                                cart.map((item) => (
                                    <div
                                        key={item.product.id}
                                        className="flex items-start space-x-3"
                                    >
                                        <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                            {item.product.image_url ? (
                                                <img
                                                    src={item.product.image_url}
                                                    alt={item.product.name}
                                                    className="w-full h-full object-cover rounded-lg"
                                                />
                                            ) : (
                                                <Package className="w-5 h-5 text-blue-300" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-sm text-gray-900 truncate">
                                                {item.product.name}
                                            </p>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                {formatBDT(Number(item.product.selling_price))} × {item.quantity}
                                            </p>
                                            <p className="text-sm font-bold text-gray-800 mt-0.5">
                                                {formatBDT(Number(item.product.selling_price) * item.quantity)}
                                            </p>
                                        </div>
                                        <div className="flex items-center space-x-1 flex-shrink-0">
                                            <button
                                                onClick={() => updateQty(item.product.id, -1)}
                                                className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200"
                                            >
                                                <Minus className="w-3 h-3" />
                                            </button>
                                            <span className="w-5 text-center text-xs font-bold">{item.quantity}</span>
                                            <button
                                                onClick={() => updateQty(item.product.id, 1)}
                                                disabled={item.quantity >= item.product.stock_quantity}
                                                className="w-6 h-6 flex items-center justify-center rounded bg-blue-100 hover:bg-blue-200 disabled:opacity-40"
                                            >
                                                <Plus className="w-3 h-3" />
                                            </button>
                                            <button
                                                onClick={() => removeFromCart(item.product.id)}
                                                className="w-6 h-6 flex items-center justify-center rounded bg-red-50 hover:bg-red-100 ml-1"
                                            >
                                                <X className="w-3 h-3 text-red-500" />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {cart.length > 0 && (
                            <div className="border-t px-5 py-4 space-y-3">
                                <div className="flex items-center justify-between text-base font-bold">
                                    <span>Total</span>
                                    <span>{formatBDT(cartTotal)}</span>
                                </div>
                                <button
                                    onClick={() => { setCheckoutOpen(true); setCartOpen(false); }}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors"
                                >
                                    Checkout
                                </button>
                            </div>
                        )}
                    </aside>
                </div>
            )}

            {/* Checkout Modal */}
            {checkoutOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                    <div
                        className="absolute inset-0 bg-black/50"
                        onClick={() => setCheckoutOpen(false)}
                    />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b">
                            <h2 className="text-lg font-bold">Checkout</h2>
                            <button onClick={() => setCheckoutOpen(false)}>
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>
                        <form onSubmit={handleCheckout} className="px-6 py-5 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Full Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    placeholder="Your full name"
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Email <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="email"
                                    required
                                    value={customerEmail}
                                    onChange={(e) => setCustomerEmail(e.target.value)}
                                    placeholder="your@email.com"
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Phone (optional)
                                </label>
                                <input
                                    type="tel"
                                    value={customerPhone}
                                    onChange={(e) => setCustomerPhone(e.target.value)}
                                    placeholder="+880..."
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Notes (optional)
                                </label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Special instructions..."
                                    rows={2}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                />
                            </div>

                            {/* Order summary */}
                            <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                                {cart.map((item) => (
                                    <div key={item.product.id} className="flex justify-between text-sm text-gray-700">
                                        <span>
                                            {item.product.name} × {item.quantity}
                                        </span>
                                        <span className="font-semibold">
                                            {formatBDT(Number(item.product.selling_price) * item.quantity)}
                                        </span>
                                    </div>
                                ))}
                                <div className="border-t mt-2 pt-2 flex justify-between text-base font-bold text-gray-900">
                                    <span>Total</span>
                                    <span>{formatBDT(cartTotal)}</span>
                                </div>
                            </div>

                            {orderError && (
                                <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">
                                    {orderError}
                                </p>
                            )}

                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-60"
                            >
                                {submitting ? 'Placing Order...' : 'Place Order'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
