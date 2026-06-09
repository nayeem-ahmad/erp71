'use client';

import { useState, useEffect } from 'react';
import { ShoppingCart, Search, Package, Trash2, Plus, Minus, CreditCard, ChevronRight, Store, X, Banknote, CheckCircle, AlertCircle, XCircle, Printer, WifiOff, RefreshCw } from 'lucide-react';
import { HelpTooltip } from '@/components/HelpTooltip';
import { api } from '../../../lib/api';
import { printPOSReceipt } from '../../../lib/pos-receipt-printer';
import { formatBDT } from '../../../lib/format';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { savePendingSale, cacheProducts, getCachedProducts } from '@/lib/pos-db';

type Notification = { id: string; type: 'success' | 'error' | 'info'; message: string };

// Generate a UUID v4 (browser-native or fallback)
function generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export default function POSPage() {
    const [products, setProducts] = useState<any[]>([]);
    const [salesWarehouseId, setSalesWarehouseId] = useState<string | null>(null);
    const [cart, setCart] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [notifications, setNotifications] = useState<Notification[]>([]);

    const [showCheckout, setShowCheckout] = useState(false);
    const [cashAmount, setCashAmount] = useState<number>(0);
    const [bkashAmount, setBkashAmount] = useState<number>(0);
    const [cardAmount, setCardAmount] = useState<number>(0);
    const [lastSale, setLastSale] = useState<any>(null);

    const [discountCodeInput, setDiscountCodeInput] = useState('');
    const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; name: string; amount: number } | null>(null);
    const [discountError, setDiscountError] = useState('');
    const [discountApplying, setDiscountApplying] = useState(false);

    const { isOnline, pendingCount, isSyncing, syncNow, refreshPendingCount } = useOfflineSync();

    const addNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        const id = Date.now().toString();
        setNotifications(prev => [...prev, { id, type, message }]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 4000);
    };

    const validateSerialNumbers = (): boolean => {
        for (const item of cart) {
            if (!item.warranty_enabled) {
                continue;
            }

            const serialNumbers = getWarrantySerialsForQuantity(item.serialNumbers, item.quantity)
                .map((value) => value.trim())
                .filter((value) => value.length > 0);

            if (serialNumbers.length !== item.quantity) {
                addNotification(`Please provide ${item.quantity} serial number(s) for ${item.name}.`, 'error');
                return false;
            }

            const unique = new Set(serialNumbers);
            if (unique.size !== serialNumbers.length) {
                addNotification(`Serial numbers for ${item.name} must be unique.`, 'error');
                return false;
            }
        }
        return true;
    };

    useEffect(() => {
        loadProducts();
    }, []);

    const resolveSalesWarehouseId = (settings: any): string | null => {
        if (!settings) return null;
        return (
            settings.default_sales_warehouse_id ||
            settings.defaultSalesWarehouseId ||
            settings.defaultSalesWarehouse?.id ||
            null
        );
    };

    const getStockForSalesWarehouse = (product: any): number => {
        const stocks = Array.isArray(product?.stocks) ? product.stocks : [];
        if (stocks.length === 0) return 0;

        if (salesWarehouseId) {
            const matchedStock = stocks.find(
                (stock: any) => stock?.warehouse_id === salesWarehouseId || stock?.warehouse?.id === salesWarehouseId,
            );
            if (matchedStock) {
                return Number(matchedStock.quantity) || 0;
            }
        }

        return Number(stocks[0]?.quantity) || 0;
    };

    const loadProducts = async () => {
        try {
            const [data, settings] = await Promise.all([
                api.getProducts(),
                api.getInventorySettings().catch(() => null),
            ]);
            setProducts(data);
            setSalesWarehouseId(resolveSalesWarehouseId(settings));
            // Cache products in IndexedDB for offline use
            try {
                await cacheProducts(data);
            } catch {
                // Non-fatal: cache may fail
            }
        } catch (error) {
            console.error('Failed to load products from network, trying cache', error);
            // Fall back to IndexedDB cache when offline
            try {
                const cached = await getCachedProducts();
                if (cached.length > 0) {
                    setProducts(cached);
                }
            } catch {
                // No cache available
            }
        } finally {
            setLoading(false);
        }
    };

    const getWarrantySerialsForQuantity = (serialNumbers: string[] | undefined, quantity: number) => {
        const normalized = (serialNumbers ?? []).slice(0, quantity).map((value) => value ?? '');
        while (normalized.length < quantity) {
            normalized.push('');
        }
        return normalized;
    };

    const addToCart = (product: any) => {
        const existing = cart.find(item => item.id === product.id);
        if (existing) {
            setCart(cart.map(item => {
                if (item.id !== product.id) {
                    return item;
                }

                const nextQuantity = item.quantity + 1;
                if (!item.warranty_enabled) {
                    return { ...item, quantity: nextQuantity };
                }

                return {
                    ...item,
                    quantity: nextQuantity,
                    serialNumbers: getWarrantySerialsForQuantity(item.serialNumbers, nextQuantity),
                };
            }));
        } else {
            setCart([
                ...cart,
                {
                    ...product,
                    quantity: 1,
                    serialNumbers: product.warranty_enabled ? [''] : undefined,
                },
            ]);
        }
    };

    const updateQuantity = (id: string, delta: number) => {
        setCart(cart.map(item => {
            if (item.id === id) {
                const newQty = Math.max(1, item.quantity + delta);

                if (!item.warranty_enabled) {
                    return { ...item, quantity: newQty };
                }

                return {
                    ...item,
                    quantity: newQty,
                    serialNumbers: getWarrantySerialsForQuantity(item.serialNumbers, newQty),
                };
            }
            return item;
        }));
    };

    const updateSerialNumber = (id: string, index: number, value: string) => {
        setCart(cart.map(item => {
            if (item.id !== id || !item.warranty_enabled) {
                return item;
            }

            const serialNumbers = getWarrantySerialsForQuantity(item.serialNumbers, item.quantity);
            serialNumbers[index] = value;

            return {
                ...item,
                serialNumbers,
            };
        }));
    };

    const removeFromCart = (id: string) => {
        setCart(cart.filter(item => item.id !== id));
    };

    const subtotal = cart.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
    const tax = subtotal * 0.1; // 10% tax mock
    const totalBeforeDiscount = subtotal + tax;
    const discountAmount = appliedDiscount?.amount ?? 0;
    const total = Math.max(0, totalBeforeDiscount - discountAmount);

    const totalPaid = (cashAmount || 0) + (bkashAmount || 0) + (cardAmount || 0);
    const changeDue = Math.max(0, totalPaid - total);

    const handleApplyDiscountCode = async () => {
        if (!discountCodeInput.trim()) return;
        setDiscountApplying(true);
        setDiscountError('');
        try {
            const result = await api.validateDiscountCode(discountCodeInput.trim(), totalBeforeDiscount);
            const data = result?.data ?? result;
            setAppliedDiscount({ code: data.code, name: data.name, amount: data.discount_amount });
            setCashAmount(Math.max(0, totalBeforeDiscount - data.discount_amount));
        } catch (err: any) {
            setDiscountError(err?.message ?? 'Invalid discount code');
            setAppliedDiscount(null);
        } finally {
            setDiscountApplying(false);
        }
    };

    const handleRemoveDiscount = () => {
        setAppliedDiscount(null);
        setDiscountCodeInput('');
        setDiscountError('');
        setCashAmount(total);
    };

    const handleCheckoutClick = () => {
        if (cart.length === 0) return;

        // Validate serial numbers BEFORE showing Payment Details dialog
        if (!validateSerialNumbers()) {
            return;
        }

        setAppliedDiscount(null);
        setDiscountCodeInput('');
        setDiscountError('');
        setCashAmount(totalBeforeDiscount);
        setBkashAmount(0);
        setCardAmount(0);
        setShowCheckout(true);
    };

    const handleConfirmCheckout = async () => {
        if (totalPaid < total) {
            addNotification('Insufficient amount paid!', 'error');
            return;
        }

        const payments = [];
        if (cashAmount > 0) payments.push({ paymentMethod: 'CASH', amount: cashAmount });
        if (bkashAmount > 0) payments.push({ paymentMethod: 'BKASH', amount: bkashAmount });
        if (cardAmount > 0) payments.push({ paymentMethod: 'CARD', amount: cardAmount });

        const counterId = localStorage.getItem('counter_id') || undefined;
        const saleData = {
            storeId: localStorage.getItem('store_id') || '',
            ...(salesWarehouseId ? { warehouseId: salesWarehouseId } : {}),
            ...(counterId ? { counterId } : {}),
            totalAmount: total,
            amountPaid: totalPaid,
            items: cart.map(item => ({
                productId: item.id,
                quantity: item.quantity,
                priceAtSale: parseFloat(item.price),
                serialNumbers: item.warranty_enabled
                    ? getWarrantySerialsForQuantity(item.serialNumbers, item.quantity)
                          .map((value) => value.trim())
                          .filter((value) => value.length > 0)
                    : undefined,
            })),
            payments,
        };

        // If offline, queue the sale instead of submitting
        if (!isOnline) {
            try {
                await savePendingSale({
                    ...saleData,
                    id: generateId(),
                    createdAt: new Date().toISOString(),
                    authToken: localStorage.getItem('access_token') || '',
                    tenantId: localStorage.getItem('tenant_id') || '',
                });
                await refreshPendingCount();
                addNotification('Sale saved offline — will sync when online', 'info');
                setCart([]);
                setShowCheckout(false);
            } catch {
                addNotification('Failed to save offline sale. Please try again.', 'error');
            }
            return;
        }

        try {
            const sale = await api.createSale(saleData);
            setLastSale({ sale, cart: [...cart], payments, subtotal, tax, total, totalPaid, changeDue });
            if (appliedDiscount) {
                api.useDiscountCode(appliedDiscount.code).catch(() => {});
            }
            addNotification('Sale completed successfully!', 'success');
            setCart([]);
            setAppliedDiscount(null);
            setDiscountCodeInput('');
            setShowCheckout(false);
            loadProducts(); // Update stock levels
        } catch (error: any) {
            // Detect network failure and queue offline
            const isNetworkError =
                !navigator.onLine ||
                error?.message?.toLowerCase().includes('failed to fetch') ||
                error?.message?.toLowerCase().includes('network');

            if (isNetworkError) {
                try {
                    await savePendingSale({
                        ...saleData,
                        id: generateId(),
                        createdAt: new Date().toISOString(),
                        authToken: localStorage.getItem('access_token') || '',
                        tenantId: localStorage.getItem('tenant_id') || '',
                    });
                    await refreshPendingCount();
                    addNotification('Sale saved offline — will sync when online', 'info');
                    setCart([]);
                    setShowCheckout(false);
                } catch {
                    addNotification('Checkout failed. Please check stock levels.', 'error');
                }
            } else {
                console.error('Checkout failed', error);
                addNotification('Checkout failed. Please check stock levels.', 'error');
            }
        }
    };

    const handlePrintReceipt = async (saleSnapshot: typeof lastSale) => {
        if (!saleSnapshot) return;
        const { sale, cart: saleCart, payments, subtotal: sub, tax: taxAmt, total: tot, totalPaid: paid, changeDue: change } = saleSnapshot;

        await printPOSReceipt({
            invoiceId: sale?.id || '',
            serialNumber: sale?.serial_number || '',
            date: sale?.created_at ? new Date(sale.created_at).toLocaleString() : new Date().toLocaleString(),
            items: saleCart.map((item: any) => ({
                name: item.name,
                sku: item.sku,
                quantity: item.quantity,
                unitPrice: parseFloat(item.price),
            })),
            payments: payments.map((p: any) => ({ method: p.paymentMethod, amount: p.amount })),
            subtotal: sub,
            tax: taxAmt,
            total: tot,
            amountPaid: paid,
            changeDue: change,
        });
    };

    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="flex h-full bg-[#f3f4f6] font-sans text-gray-900 overflow-hidden flex-col">
            {/* Offline banner */}
            {!isOnline && (
                <div className="bg-yellow-50 border-b border-yellow-200 px-6 py-2.5 flex items-center justify-between gap-4 flex-shrink-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-yellow-800">
                        <WifiOff className="w-4 h-4 flex-shrink-0 text-yellow-600" />
                        <span>You are offline. Sales will be queued and synced when you reconnect.</span>
                        {pendingCount > 0 && (
                            <span className="ml-1 bg-yellow-200 text-yellow-900 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest">
                                {pendingCount} pending
                            </span>
                        )}
                    </div>
                    <button
                        onClick={syncNow}
                        disabled={isSyncing}
                        className="flex items-center gap-1.5 text-xs font-bold bg-yellow-200 hover:bg-yellow-300 text-yellow-900 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                        <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing…' : 'Sync now'}
                    </button>
                </div>
            )}

            <div className="flex flex-1 overflow-hidden">
                {/* Left Section: Product Selection */}
                <div className="flex-1 flex flex-col p-6 space-y-6 overflow-hidden">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-black tracking-tight inline-flex items-center gap-2">POS Terminal <HelpTooltip text="Select items, choose a payment method, then press Checkout. For split payments, add multiple payment rows. Change due is calculated automatically." /></h1>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">Quick selection &amp; billing</p>
                        </div>
                        <div className="relative w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                                type="text"
                                placeholder="Search SKU or Name..."
                                className="w-full bg-white border-none rounded-xl py-2.5 pl-10 pr-4 text-sm shadow-sm focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                        {loading ? (
                            <div className="flex items-center justify-center h-full text-gray-400 font-bold uppercase tracking-widest text-xs">Loading Products...</div>
                        ) : (
                            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {filteredProducts.map((product) => (
                                    <div
                                        key={product.id}
                                        onClick={() => addToCart(product)}
                                        className="bg-white p-4 rounded-3xl shadow-sm border border-transparent hover:border-blue-500/20 hover:shadow-xl hover:shadow-blue-500/5 cursor-pointer transition-all group flex flex-col items-center text-center space-y-3"
                                    >
                                        <div className="w-full aspect-square bg-gray-50 rounded-2xl flex items-center justify-center overflow-hidden">
                                            {product.image_url ? (
                                                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                                            ) : (
                                                <Package className="w-8 h-8 text-gray-200" />
                                            )}
                                        </div>
                                        <div className="w-full">
                                            <h3 className="text-sm font-black tracking-tight text-gray-900 truncate">{product.name}</h3>
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter mb-2">{product.sku || 'N/A'}</p>
                                            <div className="flex items-center justify-between mt-2">
                                                <span className="text-lg font-black text-blue-600">${product.price}</span>
                                                <span className="bg-gray-100 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest text-gray-500">
                                                    {getStockForSalesWarehouse(product)} left
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Section: Cart & Checkout */}
                <div className="w-[400px] bg-white border-l border-gray-100 flex flex-col shadow-2xl">
                    <div className="p-6 border-b border-gray-50 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                                <ShoppingCart className="w-6 h-6" />
                            </div>
                            <h2 className="text-lg font-black tracking-tight">Current Cart</h2>
                        </div>
                        <span className="bg-gray-900 text-white px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                            {cart.length} Items
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {cart.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-300 space-y-4">
                                <ShoppingCart className="w-16 h-16 opacity-20" />
                                <p className="text-xs font-black uppercase tracking-widest">Cart is empty</p>
                            </div>
                        ) : (
                            cart.map((item) => (
                                <div key={item.id} className="bg-gray-50/50 p-4 rounded-2xl group border border-transparent hover:border-blue-500/10 hover:bg-white hover:shadow-lg hover:shadow-blue-500/5 transition-all space-y-3">
                                    <div className="flex items-center space-x-4">
                                        <div className="w-12 h-12 bg-white rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden border border-gray-100">
                                            {item.image_url ? (
                                                <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <Package className="w-5 h-5 text-gray-200" />
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <h4 className="text-sm font-black tracking-tight text-gray-900 leading-tight">{item.name}</h4>
                                            <p className="text-xs font-bold text-blue-600 mt-0.5">${item.price}</p>
                                            {item.warranty_enabled && (
                                                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mt-1">Warranty serial required</p>
                                            )}
                                        </div>
                                        <div className="flex items-center bg-white rounded-xl p-1 shadow-sm border border-gray-100">
                                            <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:text-blue-600 transition-colors"><Minus className="w-4 h-4" /></button>
                                            <span className="w-8 text-center text-xs font-black">{item.quantity}</span>
                                            <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:text-blue-600 transition-colors"><Plus className="w-4 h-4" /></button>
                                        </div>
                                        <button onClick={() => removeFromCart(item.id)} className="p-2 text-gray-300 hover:text-rose-500 transition-colors">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {item.warranty_enabled && (
                                        <div className="bg-white border border-amber-100 rounded-xl p-3 space-y-2">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Serial numbers</p>
                                            <div className="grid grid-cols-1 gap-2">
                                                {getWarrantySerialsForQuantity(item.serialNumbers, item.quantity).map((serial: string, index: number) => (
                                                    <input
                                                        key={`${item.id}-serial-${index}`}
                                                        type="text"
                                                        value={serial}
                                                        onChange={(e) => updateSerialNumber(item.id, index, e.target.value)}
                                                        placeholder={`Unit ${index + 1} serial`}
                                                        className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-xs font-bold text-gray-900 focus:ring-2 focus:ring-amber-500/20 focus:bg-white transition-all"
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    <div className="p-8 bg-gray-50 border-t border-gray-100 space-y-6">
                        <div className="space-y-3">
                            <div className="flex justify-between text-xs font-bold text-gray-400 uppercase tracking-widest">
                                <span>Subtotal</span>
                                <span className="text-gray-900">{formatBDT(subtotal)}</span>
                            </div>
                            <div className="flex justify-between text-xs font-bold text-gray-400 uppercase tracking-widest">
                                <span>Tax (10%)</span>
                                <span className="text-gray-900">{formatBDT(tax)}</span>
                            </div>
                            <div className="pt-3 border-t border-dashed border-gray-200 flex justify-between">
                                <span className="text-sm font-black uppercase tracking-widest">Total Pay</span>
                                <span className="text-2xl font-black text-blue-600">{formatBDT(total)}</span>
                            </div>
                        </div>

                        {/* Pending sync badge */}
                        {pendingCount > 0 && (
                            <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-2">
                                <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                                <span className="text-xs font-bold text-yellow-800">
                                    {pendingCount} sale{pendingCount !== 1 ? 's' : ''} pending sync
                                </span>
                            </div>
                        )}

                        <button
                            onClick={handleCheckoutClick}
                            disabled={cart.length === 0}
                            className="w-full bg-gray-900 hover:bg-blue-600 text-white py-4 rounded-3xl font-black text-sm uppercase tracking-widest shadow-xl shadow-gray-200 flex items-center justify-center group transition-all hover:-translate-y-1 active:translate-y-0 disabled:opacity-20 disabled:grayscale disabled:translate-y-0"
                        >
                            <CreditCard className="w-5 h-5 mr-3 group-hover:animate-bounce" />
                            {isOnline ? 'Complete Checkout' : 'Save Offline'}
                            <ChevronRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Print Receipt Modal */}
            {lastSale && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-white w-[420px] rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100 bg-green-50/50 flex items-center space-x-4">
                            <div className="p-3 bg-green-100 rounded-2xl text-green-600">
                                <CheckCircle className="w-7 h-7" />
                            </div>
                            <div>
                                <h2 className="text-xl font-black tracking-tight text-gray-900">Sale Complete!</h2>
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-0.5">{lastSale.sale?.serial_number}</p>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
                                <div className="flex justify-between text-xs font-bold text-gray-500 uppercase tracking-widest">
                                    <span>Total</span>
                                    <span className="text-gray-900">{formatBDT(lastSale.total)}</span>
                                </div>
                                <div className="flex justify-between text-xs font-bold text-gray-500 uppercase tracking-widest">
                                    <span>Paid</span>
                                    <span className="text-gray-900">{formatBDT(lastSale.totalPaid)}</span>
                                </div>
                                <div className="flex justify-between text-xs font-bold text-green-600 uppercase tracking-widest pt-1 border-t border-gray-200">
                                    <span>Change Due</span>
                                    <span>{formatBDT(lastSale.changeDue)}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => handlePrintReceipt(lastSale)}
                                className="w-full bg-gray-900 hover:bg-blue-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg flex items-center justify-center space-x-3 transition-all hover:-translate-y-0.5"
                            >
                                <Printer className="w-5 h-5" />
                                <span>Print POS Receipt</span>
                            </button>
                        </div>
                        <div className="px-6 pb-6">
                            <button
                                onClick={() => setLastSale(null)}
                                className="w-full py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-gray-400 hover:text-gray-900 hover:bg-gray-50 transition-all"
                            >
                                Skip &amp; Continue
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Checkout Modal */}
            {showCheckout && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-white w-[500px] rounded-3xl shadow-2xl overflow-hidden flex flex-col">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <div className="flex items-center space-x-3">
                                <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                                    <Banknote className="w-6 h-6" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-black tracking-tight">Payment Details</h2>
                                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Split or multiple methods</p>
                                </div>
                            </div>
                            <button onClick={() => setShowCheckout(false)} className="p-2 hover:bg-white rounded-xl text-gray-400 hover:text-gray-900 transition-all shadow-sm">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-6">
                            <div className="bg-blue-50 p-4 rounded-2xl flex items-center justify-between border border-blue-100">
                                <div>
                                    <span className="font-black uppercase tracking-widest text-blue-900 text-sm">Total Due</span>
                                    {appliedDiscount && (
                                        <div className="text-xs text-green-600 font-semibold mt-0.5">
                                            -{formatBDT(appliedDiscount.amount)} ({appliedDiscount.name})
                                        </div>
                                    )}
                                </div>
                                <span className="text-3xl font-black text-blue-600">{formatBDT(total)}</span>
                            </div>

                            {/* Discount Code */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">Discount Code</label>
                                {appliedDiscount ? (
                                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                                        <div>
                                            <span className="font-mono font-bold text-green-800">{appliedDiscount.code}</span>
                                            <span className="text-xs text-green-600 ml-2">-{formatBDT(appliedDiscount.amount)}</span>
                                        </div>
                                        <button onClick={handleRemoveDiscount} className="text-green-500 hover:text-red-500 transition-colors">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={discountCodeInput}
                                            onChange={e => { setDiscountCodeInput(e.target.value.toUpperCase()); setDiscountError(''); }}
                                            onKeyDown={e => e.key === 'Enter' && handleApplyDiscountCode()}
                                            placeholder="Enter code (optional)"
                                            className="flex-1 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-mono text-sm text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm uppercase"
                                        />
                                        <button
                                            onClick={handleApplyDiscountCode}
                                            disabled={discountApplying || !discountCodeInput.trim()}
                                            className="px-4 py-3 bg-gray-900 text-white rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-40 hover:bg-gray-700 transition-colors"
                                        >
                                            {discountApplying ? '…' : 'Apply'}
                                        </button>
                                    </div>
                                )}
                                {discountError && (
                                    <p className="text-xs text-red-500 font-medium">{discountError}</p>
                                )}
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">Cash Paid</label>
                                    <input type="number" min="0" value={cashAmount || ''} onChange={(e) => setCashAmount(parseFloat(e.target.value) || 0)} className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-black text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm" placeholder="0.00" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">bKash</label>
                                    <input type="number" min="0" value={bkashAmount || ''} onChange={(e) => setBkashAmount(parseFloat(e.target.value) || 0)} className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-black text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm" placeholder="0.00" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">Credit Card</label>
                                    <input type="number" min="0" value={cardAmount || ''} onChange={(e) => setCardAmount(parseFloat(e.target.value) || 0)} className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-black text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm" placeholder="0.00" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-dashed border-gray-200">
                                <div className="bg-gray-50 p-3 rounded-2xl flex flex-col justify-center">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Total Paid</span>
                                    <span className="text-lg font-black text-gray-900">{formatBDT(totalPaid)}</span>
                                </div>
                                <div className={`p-3 rounded-2xl flex flex-col justify-center ${totalPaid < total ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                                    <span className={`text-[10px] font-black uppercase tracking-widest mb-1 ${totalPaid < total ? 'text-red-400' : 'text-green-500'}`}>
                                        {totalPaid < total ? 'Remaining' : 'Change Due'}
                                    </span>
                                    <span className="text-lg font-black">{formatBDT(Math.abs(totalPaid - total))}</span>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 bg-gray-50 border-t border-gray-100">
                            <button
                                onClick={handleConfirmCheckout}
                                disabled={totalPaid < total}
                                className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 hover:-translate-y-0.5"
                            >
                                {isOnline ? 'Confirm Transaction' : 'Save Offline Sale'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Notification Toasts */}
            <div className="fixed top-6 right-6 z-[100] space-y-3 pointer-events-none">
                {notifications.map(notif => (
                    <div
                        key={notif.id}
                        className={`flex items-start space-x-3 px-4 py-3 rounded-2xl shadow-lg border animate-in slide-in-from-right-full pointer-events-auto ${
                            notif.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
                            notif.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
                            'bg-blue-50 border-blue-200 text-blue-800'
                        }`}
                    >
                        {notif.type === 'success' && <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                        {notif.type === 'error' && <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                        {notif.type === 'info' && <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                        <p className="text-sm font-bold">{notif.message}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
