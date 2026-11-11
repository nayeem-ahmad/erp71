'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { staffingHeatClass } from '@/lib/staffing-heat';

export type StaffingRole = 'MANAGER' | 'MEMBER' | 'VIEWER';

export interface StaffingCell {
    role: StaffingRole | null;
    isManager: boolean;
    remainingHours: number;
    openTasks: number;
    assignedNotOnTeam: boolean;
}

export interface StaffingProject {
    id: string;
    code: string;
    shortName: string | null;
    name: string;
    status: string;
}

export interface StaffingPerson {
    key: string;
    kind: 'user' | 'employee' | 'unassigned';
    id: string | null;
    name: string;
    email: string | null;
    noLogin: boolean;
    cells: Record<string, StaffingCell>;
    totals: { projectCount: number; remainingHours: number; openTasks: number };
}

export function staffingTasksHref(assignee: string, projectId?: string): string {
    return projectId
        ? `${routes.projects.tasks}?projectId=${projectId}&assignee=${assignee}`
        : `${routes.projects.tasks}?assignee=${assignee}`;
}

export function staffingProjectLabel(project: StaffingProject): string {
    return project.shortName || project.code;
}

export function formatStaffingHours(hours: number): string {
    const rounded = Math.round(hours * 100) / 100;
    return `${rounded}h`;
}

function maxCellHours(people: StaffingPerson[]): number {
    let max = 0;
    for (const person of people) {
        for (const cell of Object.values(person.cells)) {
            if (cell.remainingHours > max) max = cell.remainingHours;
        }
    }
    return max;
}

export default function StaffingMatrix({
    people,
    projects,
}: {
    people: StaffingPerson[];
    projects: StaffingProject[];
}) {
    const { t } = useI18n();
    const m = t.projects.staffing;
    const team = t.projects.team;
    const maxHours = maxCellHours(people);

    return (
        <div>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="min-w-full border-collapse text-xs">
                    <thead>
                        <tr className="border-b border-gray-200 text-start text-gray-500">
                            <th scope="col" className="sticky start-0 top-0 z-20 bg-white px-2 py-1.5 font-medium">
                                {m.person}
                            </th>
                            <th scope="col" className="sticky top-0 z-10 bg-white px-2 py-1.5 font-medium">
                                {m.remaining}
                            </th>
                            {projects.map((project) => (
                                <th
                                    key={project.id}
                                    scope="col"
                                    title={project.name}
                                    className="sticky top-0 z-10 whitespace-nowrap bg-white px-2 py-1.5 font-medium"
                                >
                                    <Link
                                        href={routes.projects.detail(project.id)}
                                        className="text-blue-600 hover:underline"
                                    >
                                        {staffingProjectLabel(project)}
                                    </Link>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {people.map((person) => {
                            const name = person.kind === 'unassigned' ? m.unassigned : person.name;
                            return (
                                <tr key={person.key} className="border-b border-gray-100 last:border-0">
                                    <th
                                        scope="row"
                                        className="sticky start-0 z-10 bg-white px-2 py-1.5 text-start font-medium"
                                    >
                                        <Link
                                            href={staffingTasksHref(person.key)}
                                            className="text-blue-600 hover:underline"
                                        >
                                            {name}
                                        </Link>
                                        {person.noLogin ? (
                                            <span className="ms-1 font-normal text-gray-500">{m.noLogin}</span>
                                        ) : null}
                                    </th>
                                    <td className="px-2 py-1.5 tabular-nums text-gray-700">
                                        {formatStaffingHours(person.totals.remainingHours)}
                                    </td>
                                    {projects.map((project) => {
                                        const cell = person.cells[project.id];
                                        if (!cell) {
                                            return <td key={project.id} className="px-2 py-1.5" />;
                                        }
                                        const role = cell.role ? team[cell.role] : null;
                                        const label = role
                                            ? `${formatStaffingHours(cell.remainingHours)} · ${role}`
                                            : formatStaffingHours(cell.remainingHours);
                                        return (
                                            <td key={project.id} className="px-1 py-1">
                                                <Link
                                                    href={staffingTasksHref(person.key, project.id)}
                                                    title={cell.assignedNotOnTeam ? m.assignedNotOnTeam : undefined}
                                                    className={`block whitespace-nowrap rounded px-2 py-1 text-center tabular-nums ${staffingHeatClass(cell.remainingHours, maxHours)}${cell.assignedNotOnTeam ? ' border border-amber-500' : ''}`}
                                                >
                                                    {label}
                                                </Link>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="mt-2 text-xs text-gray-500">{m.legend}</p>
        </div>
    );
}
