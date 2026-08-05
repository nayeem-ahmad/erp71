import PublicQuotationView, { type PublicQuotation } from './PublicQuotationView';

export const dynamic = 'force-dynamic';

function apiBase(): string {
    const configured = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return 'http://localhost:4000/api/v1';
}

/**
 * A missing token and a revoked one render the same message on purpose. Telling
 * them apart would confirm to someone guessing tokens that a given quotation
 * exists.
 */
function Unavailable() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
                <h1 className="text-sm font-semibold text-gray-900">This link is no longer available</h1>
                <p className="mt-2 text-xs text-gray-600">
                    Please ask the sender for an up-to-date link.
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
 * would be visibly distinguishable from "token not found". That must not
 * happen even though it isn't itself a per-token enumeration leak.
 */
export default async function PublicQuotationPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;

    let quotation: PublicQuotation | undefined;
    try {
        const response = await fetch(`${apiBase()}/public/quotations/${encodeURIComponent(token)}`, {
            cache: 'no-store',
        });
        if (!response.ok) return <Unavailable />;

        const body = await response.json();
        quotation = body?.data ?? body;
    } catch {
        return <Unavailable />;
    }

    // Defensive fallback, not an active path: per the backend's
    // `findByShareToken`, a revoked token has `share_token` set to `null` and
    // so fails the lookup exactly like an unknown token, returning a non-OK
    // response caught above. This only guards against a 200 with an
    // unexpectedly empty/shaped body.
    if (!quotation?.quote_number) return <Unavailable />;

    return <PublicQuotationView quotation={quotation} />;
}
