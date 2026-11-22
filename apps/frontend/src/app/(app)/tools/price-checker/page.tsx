'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, PackageSearch, ScanBarcode, X } from 'lucide-react';
import { Alert, Button, Input, PageHeader, PageShell, SkeletonBar, StatusBadge } from '@/components/ui';
import { barcodeDetector, CameraScanner } from '@/components/tools/price-checker/CameraScanner';
import type { PriceCheckProduct, PriceCheckResult } from '@/components/tools/types';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { getWorkspaceItem } from '@/lib/session-store';

const RECENT_KEY = 'erp71.priceChecker.recent';
const RECENT_LIMIT = 8;

function readRecent(): string[] {
    try {
        const parsed = JSON.parse(window.sessionStorage.getItem(RECENT_KEY) ?? '[]');
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_LIMIT) : [];
    } catch {
        return [];
    }
}

function writeRecent(codes: string[]) {
    try {
        window.sessionStorage.setItem(RECENT_KEY, JSON.stringify(codes));
    } catch {
        /* a convenience only */
    }
}

/**
 * Tools → Price checker. Built for a phone on the shop floor and for a
 * counter with a keyboard-wedge scanner: the box keeps focus, a scan ends in
 * Enter, and the answer is one big price and where the stock is.
 */
export default function PriceCheckerPage() {
    const { t, fmt, locale } = useI18n();
    const m = t.tools.priceChecker;
    const inputRef = useRef<HTMLInputElement>(null);
    const [code, setCode] = useState('');
    const [lastCode, setLastCode] = useState('');
    const [result, setResult] = useState<PriceCheckResult | null>(null);
    const [selected, setSelected] = useState<PriceCheckProduct | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [cameraAvailable, setCameraAvailable] = useState(false);
    const [recent, setRecent] = useState<string[]>([]);
    const homeStoreId = getWorkspaceItem('store_id') || '';

    useEffect(() => {
        setRecent(readRecent());
        setCameraAvailable(!!barcodeDetector());
        inputRef.current?.focus();
    }, []);

    const lookup = useCallback(
        async (raw: string) => {
            const value = raw.trim();
            if (!value) return;
            setLoading(true);
            setError(null);
            setLastCode(value);
            try {
                const found = await api.priceCheck(value);
                setResult(found);
                setSelected(found.products.length === 1 ? found.products[0] : null);
                if (found.products.length) {
                    setRecent((current) => {
                        const next = [value, ...current.filter((item) => item !== value)].slice(0, RECENT_LIMIT);
                        writeRecent(next);
                        return next;
                    });
                }
            } catch (err: unknown) {
                setResult(null);
                setSelected(null);
                setError(err instanceof Error && err.message ? err.message : m.lookupFailed);
            } finally {
                setLoading(false);
                setCode('');
                inputRef.current?.focus();
            }
        },
        [m.lookupFailed],
    );

    const onDetected = useCallback(
        (value: string) => {
            setCameraOpen(false);
            void lookup(value);
        },
        [lookup],
    );

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.tools, m.title, 'tools')}
            />

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void lookup(code);
                }}
                className="space-y-2 rounded-md border border-gray-200 bg-white p-3"
            >
                <label htmlFor="price-check-code" className="text-xs font-medium text-gray-600">
                    {m.inputLabel}
                </label>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <ScanBarcode className="pointer-events-none absolute start-2.5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden />
                        <Input
                            ref={inputRef}
                            id="price-check-code"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder={m.inputPlaceholder}
                            autoComplete="off"
                            enterKeyHint="search"
                            className="min-h-touch w-full ps-9 text-base"
                        />
                    </div>
                    <Button type="submit" size="md" loading={loading} disabled={loading || !code.trim()}>
                        {m.search}
                    </Button>
                    {cameraAvailable && (
                        <Button type="button" size="md" variant="secondary" onClick={() => setCameraOpen(true)} aria-label={m.camera} title={m.camera}>
                            <Camera className="h-4 w-4" aria-hidden />
                        </Button>
                    )}
                </div>
                <p className="text-xs text-gray-400">{m.hint}</p>
                {recent.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-xs text-gray-500">{m.recent}:</span>
                        {recent.map((item) => (
                            <button
                                key={item}
                                type="button"
                                onClick={() => void lookup(item)}
                                className="min-h-touch rounded-full border border-gray-200 px-2.5 text-xs text-gray-700 hover:border-blue-600 hover:text-blue-600 md:min-h-0 md:py-1"
                            >
                                {item}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => {
                                setRecent([]);
                                writeRecent([]);
                            }}
                            className="inline-flex min-h-touch items-center gap-1 px-1 text-xs text-gray-500 hover:text-gray-700 md:min-h-0"
                        >
                            <X className="h-3 w-3" aria-hidden /> {m.clearRecent}
                        </button>
                    </div>
                )}
            </form>

            {error && <Alert tone="danger">{error}</Alert>}

            {loading && !result ? (
                <div className="space-y-2 rounded-md border border-gray-200 bg-white p-4" aria-busy>
                    <SkeletonBar className="h-6 w-1/2" />
                    <SkeletonBar className="h-10 w-1/3" />
                    <SkeletonBar className="h-4 w-full" />
                </div>
            ) : result && result.products.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-10 text-center">
                    <PackageSearch className="h-10 w-10 text-gray-200" aria-hidden />
                    <p className="text-sm text-gray-500">{fmt(m.notFound, { code: lastCode })}</p>
                </div>
            ) : selected ? (
                <ProductCard product={selected} homeStoreId={homeStoreId} onBack={result && result.products.length > 1 ? () => setSelected(null) : undefined} />
            ) : result && result.products.length > 1 ? (
                <div className="rounded-md border border-gray-200 bg-white">
                    <p className="border-b border-gray-100 px-3 py-2 text-xs text-gray-500">{fmt(m.matches, { count: result.products.length })}</p>
                    <ul className="divide-y divide-gray-100">
                        {result.products.map((product) => (
                            <li key={product.id}>
                                <button type="button" onClick={() => setSelected(product)} className="flex min-h-touch w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-gray-50">
                                    <span>
                                        <span className="block text-sm font-medium text-gray-900">{product.name}</span>
                                        {product.sku && <span className="block text-xs text-gray-500">{fmt(m.sku, { sku: product.sku })}</span>}
                                    </span>
                                    <span className="text-end">
                                        <span className="block text-sm font-semibold tabular-nums text-gray-900">{formatBDT(product.price, { locale })}</span>
                                        <StatusBadge tone={product.totalQuantity > 0 ? 'success' : 'danger'}>
                                            {product.totalQuantity > 0 ? m.inStock : m.outOfStock}
                                        </StatusBadge>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {cameraOpen && <CameraScanner onDetected={onDetected} onClose={() => setCameraOpen(false)} />}
        </PageShell>
    );
}

function ProductCard({ product, homeStoreId, onBack }: { product: PriceCheckProduct; homeStoreId: string; onBack?: () => void }) {
    const { t, fmt, locale } = useI18n();
    const m = t.tools.priceChecker;
    const unit = product.unitType && product.unitType !== 'none' ? ` / ${product.unitType}` : '';
    const onSale = product.compareAtPrice !== null && product.compareAtPrice > product.price;

    return (
        <article className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
            {onBack && (
                <button type="button" onClick={onBack} className="min-h-touch text-xs text-blue-600 hover:underline md:min-h-0">
                    ← {t.common.back}
                </button>
            )}
            <div className="flex gap-3">
                {product.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={product.imageUrl}
                        alt=""
                        onError={(event) => {
                            // A dead link shows nothing rather than a broken-image box.
                            event.currentTarget.style.display = 'none';
                        }}
                        className="h-20 w-20 shrink-0 rounded-md border border-gray-100 object-cover"
                    />
                )}
                <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-gray-900">{product.name}</h2>
                    <p className="text-xs text-gray-500">
                        {[product.sku ? fmt(m.sku, { sku: product.sku }) : null, product.brand, product.group].filter(Boolean).join(' · ')}
                    </p>
                    <div className="mt-2 flex flex-wrap items-baseline gap-2">
                        <span className="text-xs text-gray-500">{m.price}</span>
                        <span className="text-2xl font-semibold tabular-nums text-gray-900">
                            {formatBDT(product.price, { locale })}
                            <span className="text-sm font-normal text-gray-500">{unit}</span>
                        </span>
                        {onSale && <span className="text-sm text-gray-400 line-through">{fmt(m.was, { price: formatBDT(product.compareAtPrice, { locale }) })}</span>}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <StatusBadge tone={product.totalQuantity > 0 ? 'success' : 'danger'}>{product.totalQuantity > 0 ? m.inStock : m.outOfStock}</StatusBadge>
                <span className="text-xs text-gray-500">{fmt(m.totalStock, { quantity: product.totalQuantity })}</span>
            </div>

            {product.branches.length === 0 ? (
                <p className="text-sm text-gray-500">{m.noStockRows}</p>
            ) : (
                <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                    {product.branches.map((branch) => (
                        <li key={branch.storeId} className="px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-gray-900">
                                    {branch.storeName}
                                    {branch.storeId === homeStoreId && <span className="ms-2 text-xs font-normal text-blue-600">{m.thisBranch}</span>}
                                </span>
                                <span className={`text-sm font-semibold tabular-nums ${branch.quantity > 0 ? 'text-gray-900' : 'text-red-600'}`}>{branch.quantity}</span>
                            </div>
                            {branch.warehouses.length > 1 && (
                                <ul className="mt-1 space-y-0.5">
                                    {branch.warehouses.map((warehouse) => (
                                        <li key={warehouse.warehouseId} className="flex justify-between text-xs text-gray-500">
                                            <span>{warehouse.name}</span>
                                            <span className="tabular-nums">{warehouse.quantity}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </article>
    );
}
