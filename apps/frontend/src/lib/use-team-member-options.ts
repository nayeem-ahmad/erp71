'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

export type TeamMemberOption = { id: string; label: string };

/**
 * The tenant's people, ready for a person-picker.
 *
 * The signed-in user is **relabelled** and pinned first rather than added as a
 * second option carrying the same id: two `<option>`s sharing one value make a
 * `<select>` resolve to the first on change, so a separate "Me" entry would
 * silently hijack that person's own row.
 *
 * `meLabel` is passed in because the caller owns its translation namespace.
 */
export function useTeamMemberOptions(meLabel: string) {
    const [members, setMembers] = useState<any[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    useEffect(() => {
        api.getTeamMembers()
            .then((d: any) => setMembers(Array.isArray(d) ? d : []))
            .catch(() => setMembers([]));
        api.getMe()
            .then((me: any) => setCurrentUserId(me?.id ?? null))
            .catch(() => setCurrentUserId(null));
    }, []);

    const options = useMemo<TeamMemberOption[]>(() => {
        const mapped = members
            .map((mem) => {
                const id = mem.userId ?? mem.user_id ?? mem.user?.id;
                return id
                    ? { id, label: mem.name ?? mem.user?.name ?? mem.email ?? mem.user?.email ?? id }
                    : null;
            })
            .filter((entry): entry is TeamMemberOption => entry !== null);

        if (!currentUserId) return mapped;
        const me = mapped.find((entry) => entry.id === currentUserId);
        if (!me) return mapped;
        return [{ id: currentUserId, label: meLabel }, ...mapped.filter((e) => e.id !== currentUserId)];
    }, [members, currentUserId, meLabel]);

    return { options, currentUserId };
}
