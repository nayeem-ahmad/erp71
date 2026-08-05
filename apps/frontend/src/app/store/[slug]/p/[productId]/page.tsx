import Link from 'next/link';
import { publicApiBase } from '@/lib/api-base';
import { formatBDT } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Deliberately *not* marked `noindex`, unlike the quotation page: this is a shop
 * owner's marketing page for a product they are actively trying to sell, and it
 * carries nothing a shopper on the storefront cannot already see.
 */

type PublicProduct = {
    id: string;
    name: string;
    sku: string | null;
    price: number;
    compare_at_price: number | null;
    description: string | null;
    image_url: string | null;
    in_stock: boolean;
};

/**
 * An unknown slug and an unknown product render the same message on purpose,
 * mirroring the public quotation page: telling them apart would confirm to
 * someone probing product ids whether a given storefront exists.
 */
function Unavailable() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
                <h1 className="text-sm font-semibold text-gray-900">This product isn&apos;t available</h1>
                <p className="mt-2 text-xs text-gray-600">
                    It may have been removed or the link may be out of date.
                </p>
            </div>
        </main>
    );
}

/**
 * Every failure path below — network/DNS/timeout, a non-OK status, a non-JSON
 * body, a well-formed-but-empty payload — must resolve to the same
 * `<Unavailable />` render. An uncaught throw here would fall through to the
 * app's root `error.tsx`, which renders different markup (and, without a
 * `digest`, the raw error message), so an outage or a malformed response
 * would be visibly distinguishable from "product not found". That must not
 * happen.
 */
export default async function PublicProductPage({
    params,
}: {
    params: Promise<{ slug: string; productId: string }>;
}) {
    const { slug, productId } = await params;

    let product: PublicProduct | undefined;
    try {
        const response = await fetch(
            `${publicApiBase()}/storefront/${encodeURIComponent(slug)}/products/${encodeURIComponent(productId)}`,
            { cache: 'no-store' },
        );
        if (!response.ok) return <Unavailable />;

        const body = await response.json();
        product = body?.data ?? body;
    } catch {
        return <Unavailable />;
    }

    // Defensive fallback, not an active path: guards only against a 200 with
    // an unexpectedly empty/shaped body.
    if (!product?.id) return <Unavailable />;

    return (
        <main className="min-h-screen bg-gray-50 p-3 md:p-4">
            <div className="mx-auto max-w-3xl space-y-4">
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                    {product.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={product.image_url}
                            alt={product.name}
                            className="max-h-96 w-full object-contain bg-gray-50"
                        />
                    )}
                    <div className="p-3 md:p-4">
                        <h1 className="text-base font-semibold text-gray-900">{product.name}</h1>
                        {product.sku && <p className="mt-1 text-xs text-gray-500">SKU: {product.sku}</p>}
                        <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-lg font-semibold text-gray-900">{formatBDT(product.price)}</span>
                            {product.compare_at_price ? (
                                <span className="text-sm text-gray-400 line-through">
                                    {formatBDT(product.compare_at_price)}
                                </span>
                            ) : null}
                        </div>
                        {/* The shop page only lists in-stock products, so a shared
                            link can outlive its product's availability. Showing
                            the state beats both alternatives: hiding the page
                            entirely (a dead link for something that still exists)
                            and saying nothing (a shopper who orders and then
                            finds out). */}
                        <p
                            className={`mt-2 text-xs font-semibold ${
                                product.in_stock ? 'text-emerald-600' : 'text-amber-600'
                            }`}
                        >
                            {product.in_stock ? 'In stock' : 'Out of stock'}
                        </p>
                        {product.description && (
                            <p className="mt-3 text-sm text-gray-600">{product.description}</p>
                        )}
                        <Link
                            href={`/store/${slug}/shop`}
                            className="mt-5 inline-flex min-h-touch items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                        >
                            Shop all products
                        </Link>
                    </div>
                </div>
            </div>
        </main>
    );
}
