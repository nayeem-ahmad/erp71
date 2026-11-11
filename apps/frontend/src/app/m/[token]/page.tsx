import type { Metadata } from 'next';
import { publicApiBase } from '@/lib/api-base';
import PublicMeetingView from './PublicMeetingView';
import type { PublicMeeting } from '@/components/meetings/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

function Unavailable() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
                <h1 className="text-sm font-semibold text-gray-900">This link is no longer available</h1>
                <p className="mt-2 text-xs text-gray-600">Please ask the sender for an up-to-date link.</p>
            </div>
        </main>
    );
}

export default async function PublicMeetingPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    let meeting: PublicMeeting | undefined;
    try {
        const response = await fetch(`${publicApiBase()}/public/meetings/${encodeURIComponent(token)}`, {
            cache: 'no-store',
        });
        if (!response.ok) return <Unavailable />;
        const body = await response.json();
        meeting = body?.data ?? body;
    } catch {
        return <Unavailable />;
    }
    if (!meeting?.meeting_number) return <Unavailable />;
    return <PublicMeetingView meeting={meeting} />;
}
