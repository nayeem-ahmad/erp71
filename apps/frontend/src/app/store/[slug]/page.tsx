import type { Metadata } from 'next';
import { fetchStorefrontMeta, storefrontMetadata } from '@/lib/storefront/storefront-meta';
import StorefrontHome from './StorefrontHome';

/**
 * A shop's front page.
 *
 * All this does is put a real `<head>` on `StorefrontHome`, which is a client
 * component and so cannot carry `generateMetadata` itself — see
 * `@/lib/storefront/storefront-meta` for why that mattered enough to split the
 * route in two.
 *
 * The body below the fold is unchanged and still renders in the browser: the
 * cart, the checkout and the shopper's session all live there, and hauling them
 * onto the server would buy nothing a crawler can read.
 */
type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug } = await params;
    const meta = await fetchStorefrontMeta(slug);

    return storefrontMetadata(meta, {
        description: meta ? `Shop online with ${meta.name}.` : '',
    });
}

export default async function StorefrontHomePage({ params }: { params: Promise<Params> }) {
    const { slug } = await params;
    return <StorefrontHome slug={slug} />;
}
