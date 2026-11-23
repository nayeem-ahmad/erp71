import Link from 'next/link';
import { publicApiBase } from '@/lib/api-base';
import { formatBDT } from '@/lib/format';
import { findVariant, optionValues, selectValue, valueState } from '@/lib/storefront/variant-picker';

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
    /** Set when the product is one of several sizes/colours shown as one. */
    family?: {
        id: string;
        name: string;
        option_names: string[];
        variants: Array<{
            id: string;
            label: string;
            option_values: Record<string, string>;
            in_stock: boolean;
        }>;
    } | null;
};

/**
 * One row of option links per axis. Each chip links to the variant's own page
 * — the backend opens a variant link with that variant chosen — so the picker
 * works without a line of client script and every combination has a URL a
 * shop can share. A chip whose combination is sold out is struck through; one
 * that was never made in the current choice is dimmed and leads to the nearest
 * variant that has it.
 */
function VariantLinks({ slug, product }: { slug: string; product: PublicProduct }) {
    const family = product.family;
    if (!family || family.variants.length < 2) return null;
    const current = family.variants.find((variant) => variant.id === product.id);
    const selection = current?.option_values ?? {};
    const values = optionValues(family.option_names, family.variants);

    return (
        <div className="mt-3 space-y-3">
            {family.option_names.map((name) => (
                <div key={name}>
                    <p className="mb-1.5 text-xs font-semibold text-gray-700">
                        {name}
                        {selection[name] ? <span className="font-normal text-gray-500">: {selection[name]}</span> : null}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {values[name].map((value) => {
                            const target = findVariant(
                                family.option_names,
                                family.variants,
                                selectValue(family.option_names, family.variants, selection, name, value),
                            );
                            const state = valueState(family.variants, selection, name, value);
                            const selected = selection[name] === value;
                            const tone = selected
                                ? 'border-blue-600 bg-blue-50 text-blue-700'
                                : state === 'available'
                                  ? 'border-gray-300 bg-white text-gray-900 hover:border-gray-500'
                                  : 'border-gray-200 bg-gray-50 text-gray-400';
                            return (
                                <Link
                                    key={value}
                                    href={`/store/${slug}/p/${target?.id ?? product.id}`}
                                    aria-current={selected ? 'true' : undefined}
                                    className={`inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg border px-3 text-sm font-medium ${tone} ${
                                        state === 'soldOut' ? 'line-through' : ''
                                    } ${state === 'unavailable' && !selected ? 'opacity-60' : ''}`}
                                >
                                    {value}
                                </Link>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

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
                        <h1 className="text-base font-semibold text-gray-900">{product.family?.name ?? product.name}</h1>
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
                        <VariantLinks slug={slug} product={product} />
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
