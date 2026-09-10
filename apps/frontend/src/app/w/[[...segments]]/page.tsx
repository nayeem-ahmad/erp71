import type { Metadata } from 'next';
import WorkspaceEntryClient from './WorkspaceEntryClient';

/**
 * `/w/<workspace>` — a link that opens one particular shop.
 *
 * The workspace chooser exists because an identity can hold several shops and
 * only the user knows which one they meant. A `/w/...` link *is* that answer,
 * written down ahead of time: bookmark it, put it on the counter tablet's home
 * screen, paste it in the shop's group chat, and everyone who follows it lands
 * in that shop instead of on a list.
 *
 * The whole path after the workspace is carried through as the destination, so
 * `/w/karim-store/sales/pos` opens the POS in Karim Store — signing in first if
 * nobody is signed in on this browser.
 *
 * `noindex`, like `/app-entry`: it is a redirect in page form, and it resolves
 * against a session that only exists in the browser.
 */
export const metadata: Metadata = {
    title: 'ERP71',
    robots: { index: false, follow: false },
};

export default function Page() {
    return <WorkspaceEntryClient />;
}
