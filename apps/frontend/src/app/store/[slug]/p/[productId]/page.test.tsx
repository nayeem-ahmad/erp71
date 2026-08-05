/**
 * Tests for src/app/store/[slug]/p/[productId]/page.tsx.
 *
 * Security/robustness property under test: an unknown storefront slug, an
 * unknown product id, a malformed-payload 200, a network failure, and a
 * non-JSON body must all render byte-identical markup, so a backend outage or
 * a malformed response is never visibly distinguishable from "not found" —
 * and, more importantly, so none of these paths ever throws out of the page
 * component into the root error boundary. Comparing raw HTML strings rather
 * than asserting on scoped text/testids: a future change that adds a status
 * class, a wrapper element, or (the bug this guards against) an unguarded
 * throw would fail this test even though both outcomes might still contain
 * the same visible words.
 *
 * `PublicProductPage` is called directly as a plain async function rather
 * than through Next's render pipeline — it uses no Next-only primitives, so
 * this is a faithful way to exercise it. The resulting element tree is turned
 * into an HTML string with `renderToStaticMarkup` for comparison.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import PublicProductPage from './page';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
    mockFetch.mockReset();
});

function okJson(body: unknown) {
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

function errorResponse(status: number) {
    return Promise.resolve({ ok: false, status, json: async () => ({}) } as Response);
}

/** A 200 whose body is not valid JSON — `.json()` rejects, as it does on a real Response. */
function malformedJson() {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => {
            throw new SyntaxError('Unexpected token in JSON');
        },
    } as unknown as Response);
}

async function renderPage(slug: string, productId: string) {
    const element = await PublicProductPage({ params: Promise.resolve({ slug, productId }) });
    return renderToStaticMarkup(element);
}

describe('PublicProductPage — Unavailable indistinguishability', () => {
    it('renders identical markup for an unknown slug, an unknown product, a malformed 200 body, a network failure, and a non-JSON body', async () => {
        // Unknown slug: backend has no matching storefront, 404.
        mockFetch.mockReturnValueOnce(errorResponse(404));
        const unknownSlug = await renderPage('unknown-slug', 'some-product-id');

        // Unknown product: storefront exists but the product doesn't, also 404.
        mockFetch.mockReturnValueOnce(errorResponse(404));
        const unknownProduct = await renderPage('a-real-store', 'unknown-product-id');

        // Defensive fallback: a 200 whose body doesn't look like a product.
        mockFetch.mockReturnValueOnce(okJson({ data: {} }));
        const malformedPayload = await renderPage('a-real-store', 'malformed-payload-id');

        // Network failure: fetch itself rejects (DNS, timeout, connection refused).
        mockFetch.mockReturnValueOnce(Promise.reject(new TypeError('fetch failed')));
        const networkFailure = await renderPage('a-real-store', 'network-failure-id');

        // Non-JSON body: response is 200 but .json() throws.
        mockFetch.mockReturnValueOnce(malformedJson());
        const nonJsonBody = await renderPage('a-real-store', 'non-json-id');

        expect(unknownProduct).toBe(unknownSlug);
        expect(malformedPayload).toBe(unknownSlug);
        expect(networkFailure).toBe(unknownSlug);
        expect(nonJsonBody).toBe(unknownSlug);
    });

    it('renders the real product, not Unavailable, for a valid slug/product pair — proving the equality assertions above are not vacuous', async () => {
        mockFetch.mockReturnValueOnce(
            okJson({
                data: {
                    id: 'prod-1',
                    name: 'Premium Rice 5kg',
                    sku: 'RICE-5KG',
                    price: 650,
                    compare_at_price: 700,
                    description: 'Locally sourced, premium grade.',
                    image_url: null,
                },
            }),
        );
        const validProduct = await renderPage('a-real-store', 'prod-1');

        mockFetch.mockReturnValueOnce(errorResponse(404));
        const unknownProduct = await renderPage('a-real-store', 'unknown-product-id');

        expect(validProduct).not.toBe(unknownProduct);
        expect(validProduct).toContain('Premium Rice 5kg');
        expect(unknownProduct).toContain("This product isn&#x27;t available");
    });
});

describe('PublicProductPage — availability', () => {
    function product(overrides: Record<string, unknown> = {}) {
        return {
            id: 'prod-1',
            name: 'Premium Rice 5kg',
            sku: 'RICE-5KG',
            price: 650,
            compare_at_price: null,
            description: null,
            image_url: null,
            in_stock: true,
            ...overrides,
        };
    }

    // The shop listing filters to in-stock products, so a shared product link can
    // outlive availability. The page showed nothing about stock at all, which let
    // a shopper arrive at a live-looking page for something that is not there.
    it('says the product is in stock', async () => {
        mockFetch.mockReturnValueOnce(okJson({ data: product() }));
        expect(await renderPage('a-real-store', 'prod-1')).toContain('In stock');
    });

    it('says the product is out of stock rather than hiding it', async () => {
        mockFetch.mockReturnValueOnce(okJson({ data: product({ in_stock: false }) }));
        const markup = await renderPage('a-real-store', 'prod-1');
        expect(markup).toContain('Out of stock');
        expect(markup).toContain('Premium Rice 5kg');
    });
});

describe('PublicProductPage — API base', () => {
    const originalApiBase = process.env.NEXT_PUBLIC_API_BASE;

    afterEach(() => {
        if (originalApiBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE;
        else process.env.NEXT_PUBLIC_API_BASE = originalApiBase;
    });

    it('calls the backend under /api/v1 exactly once when the configured base omits it', async () => {
        // The deploy script sets a bare origin; the backend mounts everything under
        // api/v1. Without this, every shared product link 404s in production and
        // fails closed to "This product isn't available".
        process.env.NEXT_PUBLIC_API_BASE = 'https://api.erp71.com';
        mockFetch.mockReturnValueOnce(errorResponse(404));

        await renderPage('a-real-store', 'prod-1');

        const url = String(mockFetch.mock.calls[0][0]);
        expect(url).toBe('https://api.erp71.com/api/v1/storefront/a-real-store/products/prod-1');
        expect(url.match(/\/api\/v1(\/|$)/g)?.length ?? 0).toBe(1);
    });
});
