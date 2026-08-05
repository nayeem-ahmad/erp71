/**
 * Tests for src/app/q/[token]/page.tsx.
 *
 * Security property under test: an unknown token, a revoked token, a
 * malformed-payload 200, a network failure, and a non-JSON body must all
 * render byte-identical markup, so a visitor can never distinguish "this
 * token never existed" from "this token existed and was revoked" — or from
 * "the backend is having a bad day". Comparing raw HTML strings rather than
 * asserting on scoped text/testids: a future change that adds a status class,
 * a wrapper element, or (the bug this guards against) an unguarded throw that
 * falls through to the root error boundary would fail this test even though
 * both outcomes might still contain the same visible words.
 *
 * `PublicQuotationPage` is called directly as a plain async function rather
 * than through Next's render pipeline — it uses no Next-only primitives
 * (`notFound()`, `redirect()`, `cookies()`, `headers()`), so this is a
 * faithful way to exercise it. The resulting element tree is turned into an
 * HTML string with `renderToStaticMarkup` for comparison.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import PublicQuotationPage from './page';

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

async function renderPage(token: string) {
    const element = await PublicQuotationPage({ params: Promise.resolve({ token }) });
    return renderToStaticMarkup(element);
}

describe('PublicQuotationPage — Unavailable indistinguishability', () => {
    it('renders identical markup for an unknown token, a revoked token, a malformed 200 body, a network failure, and a non-JSON body', async () => {
        // Unknown token: backend has no matching quotation, 404.
        mockFetch.mockReturnValueOnce(errorResponse(404));
        const unknownToken = await renderPage('unknown-token');

        // Revoked token: per Task 5's findByShareToken, a revoked share_token
        // is cleared to null, so the lookup fails exactly like an unknown
        // token and the backend answers with the same 404 — not a 200 with an
        // empty body. Modeled identically here on purpose.
        mockFetch.mockReturnValueOnce(errorResponse(404));
        const revokedToken = await renderPage('revoked-token');

        // Defensive fallback: a 200 whose body doesn't look like a quotation.
        mockFetch.mockReturnValueOnce(okJson({ data: {} }));
        const malformedPayload = await renderPage('malformed-payload-token');

        // Network failure: fetch itself rejects (DNS, timeout, connection refused).
        mockFetch.mockReturnValueOnce(Promise.reject(new TypeError('fetch failed')));
        const networkFailure = await renderPage('network-failure-token');

        // Non-JSON body: response is 200 but .json() throws.
        mockFetch.mockReturnValueOnce(malformedJson());
        const nonJsonBody = await renderPage('non-json-token');

        expect(revokedToken).toBe(unknownToken);
        expect(malformedPayload).toBe(unknownToken);
        expect(networkFailure).toBe(unknownToken);
        expect(nonJsonBody).toBe(unknownToken);
    });

    it('renders the real quotation, not Unavailable, for a valid token — proving the equality assertions above are not vacuous', async () => {
        mockFetch.mockReturnValueOnce(
            okJson({
                data: {
                    quote_number: 'Q-1001',
                    version: 1,
                    status: 'SENT',
                    created_at: '2026-01-01T00:00:00.000Z',
                    valid_until: null,
                    customer_name: 'Acme Traders',
                    seller_name: 'ERP71 Demo Store',
                    notes: null,
                    items: [],
                    total_amount: 0,
                },
            }),
        );
        const validToken = await renderPage('valid-token');

        mockFetch.mockReturnValueOnce(errorResponse(404));
        const unknownToken = await renderPage('unknown-token');

        expect(validToken).not.toBe(unknownToken);
        expect(validToken).toContain('Q-1001');
        expect(unknownToken).toContain('This link is no longer available');
    });
});
