import type { Metadata } from 'next';
import { fetchStorefrontMeta } from '@/lib/storefront/storefront-meta';
import StorefrontAccount from './StorefrontAccount';

/**
 * A signed-in shopper's own page at one shop. Server wrapper only for the
 * `<head>` and the shop's identity; everything personal is fetched in the
 * browser with the shopper's token.
 */
type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug } = await params;
    const meta = await fetchStorefrontMeta(slug);

    // Never indexed: there is nothing here but a sign-in prompt to a crawler.
    return {
        title: meta ? `My account — ${meta.name}` : 'My account',
        robots: { index: false, follow: false },
    };
}

export default async function StorefrontAccountPage({ params }: { params: Promise<Params> }) {
    const { slug } = await params;
    const meta = await fetchStorefrontMeta(slug);
    return <StorefrontAccount slug={slug} shop={meta} />;
}
