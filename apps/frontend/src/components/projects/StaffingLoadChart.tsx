'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import {
    formatStaffingHours,
    staffingProjectLabel,
    staffingTasksHref,
    type StaffingPerson,
    type StaffingProject,
} from './StaffingMatrix';

const BAR_SEGMENT_CLASS = [
    'bg-blue-600',
    'bg-blue-500',
    'bg-blue-400',
    'bg-sky-600',
    'bg-slate-500',
] as const;

function LoadBar({ person, projects }: { person: StaffingPerson; projects: StaffingProject[] }) {
    if (person.totals.remainingHours <= 0) {
        return (
            <div className="h-4 min-w-0 flex-1 rounded bg-gray-100">
                <div className="h-4 bg-gray-300" style={{ width: 2 }} />
            </div>
        );
    }

    return (
        <div className="flex h-4 min-w-0 flex-1 overflow-hidden rounded bg-gray-100">
            {projects.map((project, index) => {
                const hours = person.cells[project.id]?.remainingHours ?? 0;
                if (hours <= 0) return null;
                return (
                    <div
                        key={project.id}
                        className={BAR_SEGMENT_CLASS[index % BAR_SEGMENT_CLASS.length]}
                        style={{ width: `${(hours / person.totals.remainingHours) * 100}%` }}
                        title={`${staffingProjectLabel(project)} ${formatStaffingHours(hours)}`}
                    />
                );
            })}
        </div>
    );
}

function personLabel(person: StaffingPerson, unassigned: string): string {
    return person.kind === 'unassigned' ? unassigned : person.name;
}

export default function StaffingLoadChart({
    people,
    projects,
    expandable = false,
}: {
    people: StaffingPerson[];
    projects: StaffingProject[];
    expandable?: boolean;
}) {
    const { t } = useI18n();
    const m = t.projects.staffing;
    const team = t.projects.team;
    const [openKey, setOpenKey] = useState<string | null>(null);

    const coverage = projects.map((project) => ({
        project,
        count: people.filter((person) => person.kind !== 'unassigned' && person.cells[project.id]).length,
    }));
    const maxCoverage = Math.max(0, ...coverage.map((row) => row.count));

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                {projects.map((project, index) => (
                    <span key={project.id} className="inline-flex items-center gap-1">
                        <span
                            className={`inline-block h-2 w-2 rounded-sm ${BAR_SEGMENT_CLASS[index % BAR_SEGMENT_CLASS.length]}`}
                            aria-hidden
                        />
                        {staffingProjectLabel(project)}
                    </span>
                ))}
            </div>

            <div className="space-y-2">
                {people.map((person) => {
                    const name = personLabel(person, m.unassigned);
                    const hours = formatStaffingHours(person.totals.remainingHours);
                    const row = (
                        <>
                            <span className="w-32 shrink-0 truncate text-sm font-medium text-gray-900">
                                {`${name} ${hours}`}
                            </span>
                            <LoadBar person={person} projects={projects} />
                        </>
                    );

                    if (!expandable) {
                        return (
                            <div key={person.key} className="flex items-center gap-2">
                                {row}
                            </div>
                        );
                    }

                    const open = openKey === person.key;
                    return (
                        <div key={person.key}>
                            <button
                                type="button"
                                className="flex min-h-touch w-full items-center gap-2 text-start"
                                aria-expanded={open}
                                onClick={() => setOpenKey(open ? null : person.key)}
                            >
                                {row}
                            </button>
                            {open ? (
                                <ul className="ms-2 space-y-1 border-s border-gray-200 py-1 ps-3">
                                    {projects.map((project) => {
                                        const cell = person.cells[project.id];
                                        if (!cell) return null;
                                        const role = cell.role ? team[cell.role] : null;
                                        return (
                                            <li key={project.id} className="text-xs text-gray-700">
                                                <Link
                                                    href={staffingTasksHref(person.key, project.id)}
                                                    className="text-blue-600 hover:underline"
                                                >
                                                    {project.name}
                                                    {role ? ` · ${role}` : ''}
                                                    {` · ${formatStaffingHours(cell.remainingHours)}`}
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            <div className="space-y-1.5">
                {coverage.map(({ project, count }) => (
                    <div key={project.id} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 truncate text-xs text-gray-600">
                            {staffingProjectLabel(project)}
                        </span>
                        <div className="h-1.5 min-w-[60px] flex-1 rounded-full bg-gray-100">
                            <div
                                className="h-1.5 rounded-full bg-blue-600"
                                style={{ width: maxCoverage > 0 ? `${(count / maxCoverage) * 100}%` : 0 }}
                            />
                        </div>
                        <span className="w-8 text-end text-xs tabular-nums text-gray-600">{count}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
