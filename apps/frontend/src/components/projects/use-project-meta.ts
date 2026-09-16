'use client';

import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface ProjectColumn {
    id: string;
    name: string;
    category: string;
}

export interface ProjectAssignee {
    /** `user:<id>` / `employee:<id>` — the key space the whole module uses. */
    value: string;
    label: string;
}

export interface ProjectMeta {
    columns: ProjectColumn[];
    assignees: ProjectAssignee[];
    /**
     * The project read failed, so `assignees` is empty because nothing arrived
     * rather than because nobody is on the team.
     *
     * These were the same value until people started reporting "I cannot change
     * the assignee": a 404 on a private project, a 403 on a missing
     * `VIEW_PROJECTS`, and a 400 from a member holding two stores with neither
     * selected all landed as a silently empty picker, indistinguishable from an
     * empty roster and from each other.
     */
    failed: boolean;
}

interface MemberRow {
    user?: { id: string; name?: string | null; email: string } | null;
    employee?: { id: string; name: string } | null;
}

const EMPTY: ProjectMeta = { columns: [], assignees: [], failed: false };

function assigneesFrom(members: MemberRow[]): ProjectAssignee[] {
    const out: ProjectAssignee[] = [];
    const seen = new Set<string>();
    for (const member of members) {
        const entry = member.user
            ? { value: `user:${member.user.id}`, label: member.user.name || member.user.email }
            : member.employee
              ? { value: `employee:${member.employee.id}`, label: member.employee.name }
              : null;
        if (!entry || seen.has(entry.value)) continue;
        seen.add(entry.value);
        out.push(entry);
    }
    return out;
}

/**
 * A project's board columns and roster, fetched once per project and shared by
 * every row that names it.
 *
 * The Tasks list spans projects, and Phase 3L gave every project its own
 * columns, so an inline status picker cannot draw on one shared set — it needs
 * the row's own project's. Fetching that per **row** would be an N+1 that grows
 * with the page; fetching per **project** is a handful of reads for a page of
 * fifty, and only for the projects somebody actually opened a picker on.
 *
 * Nothing is fetched until `load` is called, and a second caller for a project
 * already in flight waits on the same promise rather than starting another.
 */
export function useProjectMeta() {
    const cache = useRef(new Map<string, ProjectMeta>());
    const inFlight = useRef(new Map<string, Promise<ProjectMeta>>());
    const [, bump] = useState(0);

    const load = useCallback(async (projectId: string): Promise<ProjectMeta> => {
        if (!projectId) return EMPTY;
        // A failed read is cached so `peek` can say so, but never *kept*: the
        // next open retries it. Otherwise one dropped request leaves the picker
        // empty for the life of the page, and reopening it — the obvious thing
        // to try — would do nothing.
        const cached = cache.current.get(projectId);
        if (cached && !cached.failed) return cached;
        const pending = inFlight.current.get(projectId);
        if (pending) return pending;

        const request = (async () => {
            let failed = false;
            const [columns, project] = await Promise.all([
                api.getProjectColumns(projectId).catch(() => []),
                api.getProject(projectId).catch(() => {
                    failed = true;
                    return null;
                }),
            ]);
            const members = (project as { members?: MemberRow[] } | null)?.members;
            const meta: ProjectMeta = {
                columns: Array.isArray(columns) ? (columns as ProjectColumn[]) : [],
                assignees: assigneesFrom(Array.isArray(members) ? members : []),
                failed,
            };
            cache.current.set(projectId, meta);
            inFlight.current.delete(projectId);
            // A ref holds the data so repeat reads are free; this is what tells
            // React the rows that were waiting can now draw their options.
            bump((version) => version + 1);
            return meta;
        })();

        inFlight.current.set(projectId, request);
        return request;
    }, []);

    const peek = useCallback((projectId: string): ProjectMeta | undefined => {
        return cache.current.get(projectId);
    }, []);

    /** After a write that can change a roster or a column set. */
    const forget = useCallback((projectId: string) => {
        cache.current.delete(projectId);
        inFlight.current.delete(projectId);
    }, []);

    return { load, peek, forget };
}
