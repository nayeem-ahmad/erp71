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
