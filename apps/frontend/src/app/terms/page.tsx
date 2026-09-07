import type { Metadata } from 'next';
import { siteOrigin } from '@/lib/domain-routing';
import { Suspense } from 'react';
import TermsClient from './TermsClient';

/**
 * Server wrapper that exists solely to export `metadata`.
 *
 * The page itself is a client component — it uses `useI18n`, so its copy is
 * chosen in the browser — and a client component cannot export metadata. That
 * left every marketing page shipping the layout's default title and no
 * description at all, which is what a search result and a shared link both
 * read. The split costs one file and fixes it without touching the page.
 *
 * The metadata is English on purpose: it is emitted at request time, before
 * any locale preference is known, and an English title is the right default
 * for a crawler.
 */
export const metadata: Metadata = {
    title: 'Terms of Service — ERP71',
    description: 'Terms of Service governing use of the ERP71 platform.',
    alternates: { canonical: `${siteOrigin()}/terms` },
    openGraph: {
        title: 'Terms of Service — ERP71',
        description: 'Terms of Service governing use of the ERP71 platform.',
        type: 'website',
    },
};

export default function Page() {
    // `TermsClient` reads `?plan=` to highlight the tier addendum a signup is
    // about to accept, and `useSearchParams` opts the subtree into client
    // rendering — without a boundary the whole route deopts at build time.
    return (
        <Suspense fallback={null}>
            <TermsClient />
        </Suspense>
    );
}
