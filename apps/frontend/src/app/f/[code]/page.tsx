import type { Metadata } from 'next';
import { publicApiBase } from '@/lib/api-base';
import PublicNpsSurvey, { type PublicSurvey } from './PublicNpsSurvey';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

/**
 * The receipt survey: a shop's customer says how likely they are to recommend
 * the shop. Public and session-free, like a shared meeting (`/m/[token]`) —
 * the short code in the SMS is the whole authorisation.
 */
export default async function NpsSurveyPage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;
    let survey: PublicSurvey | null = null;
    try {
        const response = await fetch(`${publicApiBase()}/public/nps/${encodeURIComponent(code)}`, { cache: 'no-store' });
        if (response.ok) {
            const body = await response.json();
            survey = (body?.data ?? body) as PublicSurvey;
        }
    } catch {
        survey = null;
    }
    return <PublicNpsSurvey code={code} survey={survey} />;
}
