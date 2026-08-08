import type { Metadata } from 'next';
import SlaClient from './SlaClient';

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
    title: 'Service Level Agreement — ERP71',
    description: 'Uptime commitments and support response times for ERP71.',
    alternates: { canonical: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.erp71.com'}/sla` },
    openGraph: {
        title: 'Service Level Agreement — ERP71',
        description: 'Uptime commitments and support response times for ERP71.',
        type: 'website',
    },
};

export default function Page() {
    return <SlaClient />;
}
