'use client';

import Link from 'next/link';
import { forwardRef, type HTMLAttributes } from 'react';
import { User } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { StatusBadge } from '@/components/ui';
import { leadStatusLabel, leadStatusTone } from '@/lib/lead-status';
import { leadPriorityColor, leadScoreColor } from '@/lib/lead-badges';
import { routes } from '@/lib/routes';
import type { BoardLead, LeadBoardGroup } from './board-columns';

type LeadCardProps = HTMLAttributes<HTMLDivElement> & {
    lead: BoardLead;
    /** The badge naming the board's own grouping is left off — the column says it. */
    group: LeadBoardGroup;
    labels: { statuses: Record<string, string>; priorities: Record<string, string>; score: string };
    /** The card under the pointer while dragging, rather than the one in its column. */
    overlay?: boolean;
    dragging?: boolean;
};

/** One lead on the board: who, how to reach them, and the badges the list shows. */
export const LeadCard = forwardRef<HTMLDivElement, LeadCardProps>(function LeadCard(
    { lead, group, labels, overlay = false, dragging = false, className = '', ...rest },
    ref,
) {
    return (
        <div
            ref={ref}
            data-testid="lead-card"
            className={`rounded-md border bg-white p-2.5 text-sm shadow-sm transition-[border-color,box-shadow,opacity] ${
                overlay ? 'cursor-grabbing border-blue-300 shadow-md' : 'border-gray-200 hover:border-blue-300'
            } ${dragging ? 'opacity-40' : ''} ${className}`}
            {...rest}
        >
            <div className="flex items-center gap-2">
                <Avatar src={lead.photo_url} name={lead.name} />
                <div className="min-w-0 flex-1">
                    <Link
                        href={routes.crm.leadDetail(lead.id)}
                        className="block truncate font-semibold text-gray-900 hover:text-blue-600"
                        title={lead.name}
                    >
                        {lead.name}
                    </Link>
                    {lead.mobile && <p className="truncate text-xs text-gray-500">{lead.mobile}</p>}
                </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {group !== 'status' && (
                    <StatusBadge tone={leadStatusTone(lead.status)}>{leadStatusLabel(lead, labels.statuses)}</StatusBadge>
                )}
                {group !== 'priority' && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${leadPriorityColor(lead.priority)}`}>
                        {labels.priorities[lead.priority] ?? lead.priority}
                    </span>
                )}
                <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${leadScoreColor(lead.score ?? 0)}`}
                    title={labels.score}
                >
                    {lead.score ?? 0}
                </span>
                {group !== 'owner' && lead.assignee && (
                    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-gray-500">
                        <User className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{lead.assignee.name}</span>
                    </span>
                )}
            </div>
        </div>
    );
});
