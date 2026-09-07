import type { Metadata } from 'next';
import AppEntryClient from './AppEntryClient';

/**
 * The app host's front door. `app.erp71.com/` is rewritten here by the
 * middleware, so this is what a bookmark, a typed hostname or a link with no
 * path lands on — the URL stays `/`.
 *
 * `noindex` because it is a redirect in page form: there is nothing here to
 * crawl, and the marketing homepage at the apex is the page that should rank.
 */
export const metadata: Metadata = {
    title: 'ERP71',
    robots: { index: false, follow: false },
};

export default function Page() {
    return <AppEntryClient />;
}
