import type { Metadata } from 'next';
import { fetchStorefrontMeta, storefrontMetadata } from '@/lib/storefront/storefront-meta';
import StorefrontShop from './StorefrontShop';

/** The shop's product list. Server wrapper for the `<head>` — see `../page.tsx`. */
type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug } = await params;
    const meta = await fetchStorefrontMeta(slug);

    return storefrontMetadata(meta, {
        suffix: 'Shop',
        description: meta ? `Browse everything ${meta.name} has in stock.` : '',
    });
}

export default async function StorefrontShopPage({ params }: { params: Promise<Params> }) {
    const { slug } = await params;
    return <StorefrontShop slug={slug} />;
}
