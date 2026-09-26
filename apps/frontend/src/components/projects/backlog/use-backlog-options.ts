'use client';

import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface ColumnOption {
    id: string;
    name: string;
    category: string;
}

export interface MemberOption {
    /** `user:<id>` / `employee:<id>`, the key the task list and bulk route use. */
    value: string;
    label: string;
}

interface ProjectOptions {
    columns: ColumnOption[] | null;
    members: MemberOption[] | null;
}

interface MemberRow {
    user?: { id: string; name?: string | null; email: string } | null;
    employee?: { id: string; name: string } | null;
}

/**
 * Each project's board columns and team, fetched the first time a picker that
 * needs them opens — a backlog of forty stories should not read forty rosters
 * to draw rows nobody edits. Held per project, because the cross-project tree
 * shows several and a task can only move between its own project's columns.
 */
export function useBacklogOptions() {
    const [byProject, setByProject] = useState<Record<string, ProjectOptions>>({});
    const inFlight = useRef(new Set<string>());

    const want = useCallback((projectId: string, what: 'columns' | 'members') => {
        const key = `${projectId}:${what}`;
        if (inFlight.current.has(key)) return;
        inFlight.current.add(key);

        const store = (patch: Partial<ProjectOptions>) =>
            setByProject((previous) => ({
                ...previous,
                [projectId]: { columns: null, members: null, ...previous[projectId], ...patch },
            }));

        if (what === 'columns') {
            api.getProjectColumns(projectId)
                .then((rows: unknown) => store({ columns: Array.isArray(rows) ? (rows as ColumnOption[]) : [] }))
                .catch(() => {
                    inFlight.current.delete(key);
                    store({ columns: [] });
                });
            return;
        }
        api.getProject(projectId)
            .then((project: unknown) => {
                const rows = ((project as { members?: MemberRow[] } | null)?.members ?? []) as MemberRow[];
                const members: MemberOption[] = [];
                for (const row of rows) {
                    if (row.user) members.push({ value: `user:${row.user.id}`, label: row.user.name || row.user.email });
                    else if (row.employee) members.push({ value: `employee:${row.employee.id}`, label: row.employee.name });
                }
                store({ members });
            })
            .catch(() => {
                inFlight.current.delete(key);
                store({ members: [] });
            });
    }, []);

    return {
        columnsOf: (projectId: string) => byProject[projectId]?.columns ?? null,
        membersOf: (projectId: string) => byProject[projectId]?.members ?? null,
        want,
    };
}
