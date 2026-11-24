'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { storefrontTheme, storefrontThemeStyle } from '@/lib/storefront/storefront-theme';
import type { StorefrontMeta } from '@/lib/storefront/storefront-meta';
import { storefrontOrderRef } from '@erp71/shared-types';

const COPY = {
    paidTitle: 'Payment received',
    paidBody: 'Thank you — your payment went through and the shop has your order.',
    pendingTitle: 'Payment is being confirmed',
    pendingBody: 'The gateway has not confirmed the payment yet. Check your order history in a moment.',
    failedTitle: 'Payment was not completed',
    failedBody: 'No money was taken. You can go back to the shop and try again, or pay on delivery.',
    cancelledTitle: 'Payment cancelled',
    cancelledBody: 'The payment was cancelled and no money was taken.',
    orderLabel: 'Order',
    backToShop: 'Back to shop',
};

function ReturnCard({ slug, shop }: { slug: string; shop: StorefrontMeta | null }) {
    const params = useSearchParams();
    const status = params.get('status') ?? 'failed';
    const orderId = params.get('orderId');

    const state =
        status === 'paid'
            ? { icon: CheckCircle, tone: 'text-emerald-600', ring: 'bg-emerald-50', title: COPY.paidTitle, body: COPY.paidBody }
            : status === 'pending'
              ? { icon: Clock, tone: 'text-amber-600', ring: 'bg-amber-50', title: COPY.pendingTitle, body: COPY.pendingBody }
              : status === 'cancelled'
                ? { icon: XCircle, tone: 'text-gray-500', ring: 'bg-gray-100', title: COPY.cancelledTitle, body: COPY.cancelledBody }
                : { icon: AlertCircle, tone: 'text-red-600', ring: 'bg-red-50', title: COPY.failedTitle, body: COPY.failedBody };

    const Icon = state.icon;

    return (
        <div
            style={storefrontThemeStyle(storefrontTheme(shop?.brand_primary_color))}
            className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-16"
        >
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8 text-center">
                <div className={`mx-auto w-14 h-14 rounded-full ${state.ring} flex items-center justify-center`}>
                    <Icon className={`w-7 h-7 ${state.tone}`} />
                </div>
                <h1 className="mt-5 text-xl font-bold text-gray-900">{state.title}</h1>
                <p className="mt-2 text-sm text-gray-600">{state.body}</p>
                {orderId && (
                    <p className="mt-4 text-sm text-gray-500">
                        {COPY.orderLabel}{' '}
                        <span className="font-mono font-semibold text-gray-800">#{storefrontOrderRef(orderId)}</span>
                    </p>
                )}
                <div className="mt-8 flex flex-col gap-2">
                    <Link
                        href={`/store/${slug}`}
                        className="w-full py-3 rounded-xl font-semibold text-center text-white transition-opacity hover:opacity-90"
                        style={{ backgroundColor: 'var(--sf-accent, #2563eb)' }}
                    >
                        {COPY.backToShop}
                    </Link>
                    <Link href={`/store/${slug}/account`} className="text-sm text-gray-500 underline hover:text-gray-700">
                        My orders
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default function StorefrontPaymentReturn({ slug, shop }: { slug: string; shop: StorefrontMeta | null }) {
    return (
        <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
            <ReturnCard slug={slug} shop={shop} />
        </Suspense>
    );
}
