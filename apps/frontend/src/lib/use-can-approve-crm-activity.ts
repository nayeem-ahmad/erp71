'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { hasPermission, isOwner, tenantFromMe } from '@/lib/permissions';
import { getWorkspaceItem } from '@/lib/session-store';

/**
 * Whether the signed-in member may sign off a planned CRM activity: the
 * workspace owner, or a holder of APPROVE_CRM_ACTIVITY.
 *
 * `false` until `/auth/me` answers, and if it fails. The switch this drives is
 * rendered disabled rather than hidden, so erring closed costs a moment of grey,
 * never a sign-off the server would refuse — it checks the permission either way.
 */
export function useCanApproveCrmActivity(): boolean {
    const [canApprove, setCanApprove] = useState(false);

    useEffect(() => {
        api.getMe()
            .then((me: unknown) => {
                const payload = me as {
                    tenants?: { id: string; role?: string | null; permissions?: string[] }[];
                };
                const tenant = tenantFromMe(payload, getWorkspaceItem('tenant_id'));
                setCanApprove(isOwner(tenant?.role) || hasPermission(tenant?.permissions, 'APPROVE_CRM_ACTIVITY'));
            })
            .catch(() => setCanApprove(false));
    }, []);

    return canApprove;
}
