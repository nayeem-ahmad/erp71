import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * CSP `frame-ancestors 'self'` is set as an HTTP header on this route by
 * `next.config.js` `headers()` and by middleware. It cannot live in
 * `metadata`: browsers ignore `frame-ancestors` in a `<meta>` CSP, which is
 * the whole point of this header — an iframe of this page would not see the
 * first-party JWT, and a future implementer must not "fix" SSO that way.
 */
export const metadata: Metadata = {
    title: 'Continuing to Meet71',
    robots: { index: false, follow: false },
};

export default function Meet71SsoLayout({ children }: { children: ReactNode }) {
    return children;
}
