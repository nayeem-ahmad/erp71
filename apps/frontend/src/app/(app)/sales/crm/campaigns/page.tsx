'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { routes } from '@/lib/routes';

export default function LegacyCrmCampaignsRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace(routes.crm.campaigns);
    }, [router]);
    return null;
}