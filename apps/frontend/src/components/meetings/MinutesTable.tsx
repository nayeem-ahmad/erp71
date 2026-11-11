'use client';

import type { MeetingAction, MeetingDiscussion } from './types';

type Labels = {
    number: string;
    discussion: string;
    action: string;
    responsible: string;
    deadline: string;
    status: string;
    decision: string;
    none: string;
    statuses: Record<string, string>;
};

function responsible(action: MeetingAction): string {
    const org = action.assignee_org ? ` (${action.assignee_org})` : '';
    const extras = action.others.map((person) => person.name).filter(Boolean);
    return `${action.assignee_name}${org}${extras.length ? ` (+ ${extras.join(', ')})` : ''}`;
}

function day(value: string): string {
    return value.slice(0, 10);
}

export default function MinutesTable({
    discussions,
    labels,
    compact = false,
}: {
    discussions: MeetingDiscussion[];
    labels: Labels;
    compact?: boolean;
}) {
    const cell = compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm';

    return (
        <div>
            <div className="space-y-3 md:hidden print:hidden">
                {discussions.length === 0 ? (
                    <p className="rounded-lg border border-gray-200 p-3 text-sm text-gray-500">{labels.none}</p>
                ) : discussions.map((discussion) => (
                    <article key={discussion.id ?? discussion.position} className="space-y-2 rounded-lg border border-gray-200 p-3">
                        <p className="text-xs text-gray-500">{discussion.position}</p>
                        <h3 className="text-sm font-semibold text-gray-900">{discussion.title}</h3>
                        {discussion.description ? (
                            <p className="whitespace-pre-wrap text-sm text-gray-600">{discussion.description}</p>
                        ) : null}
                        {discussion.decision ? (
                            <p className="text-sm text-gray-800">
                                <span className="font-medium">{labels.decision}:</span> {discussion.decision}
                            </p>
                        ) : null}
                        {discussion.actionItems.length === 0 ? (
                            <p className="text-sm text-gray-400">{labels.none}</p>
                        ) : (
                            <ul className="space-y-2">
                                {discussion.actionItems.map((action) => (
                                    <li key={action.id ?? `${discussion.position}-${action.position}`} className="rounded-md bg-gray-50 p-2 text-sm">
                                        <p>
                                            {action.priority === 'HIGH' ? (
                                                <span className="me-1 text-red-600" aria-hidden>●</span>
                                            ) : null}
                                            {discussion.position}.{action.position} {action.description}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-500">
                                            {responsible(action)} · {day(action.due_date)} · {labels.statuses[action.status] ?? action.status}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </article>
                ))}
            </div>
            <div className="hidden overflow-x-auto md:block print:block">
                <table className="min-w-full border-collapse border border-gray-200 text-start">
                    <thead>
                        <tr className="bg-gray-50">
                            <th className={`${cell} border border-gray-200 font-medium text-gray-700 w-10`}>{labels.number}</th>
                            <th className={`${cell} border border-gray-200 font-medium text-gray-700`}>{labels.discussion}</th>
                            <th className={`${cell} border border-gray-200 font-medium text-gray-700`}>{labels.action}</th>
                            <th className={`${cell} border border-gray-200 font-medium text-gray-700`}>{labels.responsible}</th>
                            <th className={`${cell} border border-gray-200 font-medium text-gray-700`}>{labels.deadline}</th>
                            <th className={`${cell} border border-gray-200 font-medium text-gray-700`}>{labels.status}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {discussions.length === 0 ? (
                            <tr>
                                <td colSpan={6} className={`${cell} border border-gray-200 text-gray-500`}>{labels.none}</td>
                            </tr>
                        ) : discussions.map((discussion) => {
                            const actions = discussion.actionItems.length ? discussion.actionItems : [null];
                            return actions.map((action, index) => (
                                <tr key={`${discussion.id ?? discussion.position}-${index}`} className="break-inside-avoid">
                                    {index === 0 ? (
                                        <td rowSpan={actions.length} className={`${cell} border border-gray-200 align-top text-gray-500`}>
                                            {discussion.position}
                                        </td>
                                    ) : null}
                                    {index === 0 ? (
                                        <td rowSpan={actions.length} className={`${cell} border border-gray-200 align-top`}>
                                            <div className="font-semibold text-gray-900">{discussion.title}</div>
                                            {discussion.description ? (
                                                <p className="mt-1 text-gray-600 whitespace-pre-wrap">{discussion.description}</p>
                                            ) : null}
                                            {discussion.decision ? (
                                                <p className="mt-1 text-gray-800">
                                                    <span className="font-medium">{labels.decision}:</span> {discussion.decision}
                                                </p>
                                            ) : null}
                                        </td>
                                    ) : null}
                                    {action ? (
                                        <>
                                            <td className={`${cell} border border-gray-200 align-top`}>
                                                {action.priority === 'HIGH' ? (
                                                    <span className="me-1 text-red-600" aria-hidden>●</span>
                                                ) : null}
                                                {discussion.position}.{action.position} {action.description}
                                            </td>
                                            <td className={`${cell} border border-gray-200 align-top`}>{responsible(action)}</td>
                                            <td className={`${cell} border border-gray-200 align-top whitespace-nowrap`}>{day(action.due_date)}</td>
                                            <td className={`${cell} border border-gray-200 align-top`}>{labels.statuses[action.status] ?? action.status}</td>
                                        </>
                                    ) : (
                                        <td colSpan={4} className={`${cell} border border-gray-200 text-gray-400`}>{labels.none}</td>
                                    )}
                                </tr>
                            ));
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
