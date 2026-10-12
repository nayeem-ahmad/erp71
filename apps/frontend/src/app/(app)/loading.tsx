import { PageSkeleton } from '@/components/ui/PageSkeleton';

/*
 * The outline of the next page, shown the moment a link inside the app is
 * clicked — the fallback for every `(app)` route without a closer
 * `loading.tsx` of its own.
 *
 * It replaces the page, never the app shell. Next keeps a segment's loading
 * boundary in that segment's layout's `children` slot (layout-router reads it
 * off the parent cache node), so this renders inside `(app)/layout.tsx`'s
 * `<main>`: sidebar, header and the open widgets stay mounted while it shows.
 *
 * It is also what makes the click immediate. Every route is dynamic (the root
 * layout reads the locale cookie), and `<Link>` can prefetch a dynamic route
 * only down to its nearest `loading.tsx`; without one there was nothing to
 * show until the server answered, a full round trip from Dhaka. A list is the
 * commonest page under `(app)`, so that is the default shape.
 *
 * Imported from its own file, not the `@/components/ui` barrel — see the note
 * at the top of `PageSkeleton.tsx`.
 */
export default function AppLoading() {
    return <PageSkeleton />;
}
