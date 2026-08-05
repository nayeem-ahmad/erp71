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

export default async function PublicQuotationPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;

    const response = await fetch(`${apiBase()}/public/quotations/${encodeURIComponent(token)}`, {
        cache: 'no-store',
    });
    if (!response.ok) return <Unavailable />;

    const body = await response.json();
    const quotation: PublicQuotation = body?.data ?? body;
    if (!quotation?.quote_number) return <Unavailable />;

    return <PublicQuotationView quotation={quotation} />;
}
