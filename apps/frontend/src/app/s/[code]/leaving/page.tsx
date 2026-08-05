import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, ShieldAlert } from 'lucide-react';

export const dynamic = 'force-dynamic';

function apiBase(): string {
    const configured = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return 'http://localhost:4000/api/v1';
}

/**
 * Shown before leaving app.erp71.com for a third-party site. The destination is
 * re-resolved from the code here rather than passed in the URL, so what the page
 * displays is always what the link actually stored.
 */
export default async function LeavingPage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;

    const response = await fetch(`${apiBase()}/short-links/resolve/${encodeURIComponent(code)}`, {
        cache: 'no-store',
    });
    if (!response.ok) notFound();

    const body = await response.json();
    const data = body?.data ?? body;
    if (data?.kind !== 'external') notFound();

    const target: string = data.target_url;
    const host = new URL(target).host;

    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-amber-600">
                    <ShieldAlert className="h-5 w-5" />
                    <h1 className="text-sm font-semibold">You are leaving ERP71</h1>
                </div>
                <p className="mt-3 text-sm text-gray-600">This link goes to an external website:</p>
                <p className="mt-2 break-all rounded-md bg-gray-50 p-3 text-sm font-medium text-gray-900">
                    {host}
                </p>
                <p className="mt-3 text-xs text-gray-500 break-all">{target}</p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <a
                        href={target}
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-touch flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                        <ExternalLink className="h-4 w-4" />
                        Continue
                    </a>
                    <Link
                        href="/"
                        className="inline-flex min-h-touch flex-1 items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        Cancel
                    </Link>
                </div>
            </div>
        </main>
    );
}
