import type { Metadata } from 'next';
import { fetchStorefrontMeta } from '@/lib/storefront/storefront-meta';
import StorefrontPaymentReturn from './StorefrontPaymentReturn';

/** Where the gateway sends the shopper back to. Never indexed. */
type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug } = await params;
    const meta = await fetchStorefrontMeta(slug);
    return {
        title: meta ? `Payment — ${meta.name}` : 'Payment',
        robots: { index: false, follow: false },
    };
}

export default async function StorefrontPaymentReturnPage({ params }: { params: Promise<Params> }) {
    const { slug } = await params;
    const meta = await fetchStorefrontMeta(slug);
    return <StorefrontPaymentReturn slug={slug} shop={meta} />;
}
