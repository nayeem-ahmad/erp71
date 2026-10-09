'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { appHomeHref } from '@/lib/app-shell';
import { useHomeApps } from './use-home-apps';

/**
 * A member who can open exactly one app has nothing to choose on Home, so
 * they land in that app instead — a Project User on their tasks, a cashier on
 * Sales. The owner always stays: Home is where the business's health is.
 * Rendered only with the app shell on.
 */
export default function HomeLanding({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
    const router = useRouter();
    const home = useHomeApps();
    const target = !home.isOwner && home.tiles.length === 1 ? appHomeHref(home.tiles[0].modules[0]) : null;

    useEffect(() => {
        if (target) router.replace(target);
    }, [router, target]);

    return <>{target ? fallback : children}</>;
}
