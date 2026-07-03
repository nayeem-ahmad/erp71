'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { routes } from '@/lib/routes';

export default function StorefrontOrdersRedirectPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace(`${routes.sales.orders}?tab=online`);
    }, [router]);

    return null;
}