'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { routes } from '@/lib/routes';

/** My Tasks became Tasks in Phase 2. Kept because people bookmark these. */
export default function LegacyMyTasksRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace(routes.projects.tasks);
    }, [router]);
    return null;
}
