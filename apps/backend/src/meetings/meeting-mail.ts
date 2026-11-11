/** Escape for HTML email bodies. */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export type MailPerson = {
    name: string;
    email?: string | null;
    organization?: string | null;
};

export type MailAction = {
    position: number;
    description: string;
    assignee_name: string;
    assignee_org?: string | null;
    due_date: Date | string;
    status: string;
    priority: string;
    others: MailPerson[];
};

export type MailDiscussion = {
    position: number;
    title: string;
    description?: string | null;
    decision?: string | null;
    actionItems: MailAction[];
};

export type MailMinutes = {
    meeting_number: string;
    title: string;
    starts_at: Date | string;
    venue?: string | null;
    organizerName: string;
    discussions: MailDiscussion[];
};

function formatDay(value: Date | string): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
}

function responsibleLabel(action: MailAction): string {
    const org = action.assignee_org ? ` (${action.assignee_org})` : '';
    const extras = action.others.map((person) => person.name).filter(Boolean);
    const plus = extras.length ? ` (+ ${extras.join(', ')})` : '';
    return `${action.assignee_name}${org}${plus}`;
}

function actionNumber(discussion: MailDiscussion, action: MailAction): string {
    return `${discussion.position}.${action.position}`;
}

/** The minutes table used in assignment, reminder and "email minutes" mail. */
export function minutesTableHtml(minutes: MailMinutes): string {
    const rows: string[] = [];
    for (const discussion of minutes.discussions) {
        const actions = discussion.actionItems.length ? discussion.actionItems : [null];
        const span = actions.length;
        actions.forEach((action, index) => {
            const discussionCell = index === 0
                ? `<td rowspan="${span}" style="vertical-align:top;padding:8px;border:1px solid #d1d5db">
                    <strong>${escapeHtml(discussion.title)}</strong>
                    ${discussion.description ? `<div style="margin-top:4px;color:#4b5563">${escapeHtml(discussion.description)}</div>` : ''}
                    ${discussion.decision ? `<div style="margin-top:4px"><em>Decision:</em> ${escapeHtml(discussion.decision)}</div>` : ''}
                   </td>`
                : '';
            const actionCell = action
                ? `<td style="padding:8px;border:1px solid #d1d5db">${escapeHtml(actionNumber(discussion, action))} ${escapeHtml(action.description)}</td>
                   <td style="padding:8px;border:1px solid #d1d5db">${escapeHtml(responsibleLabel(action))}</td>
                   <td style="padding:8px;border:1px solid #d1d5db">${formatDay(action.due_date)}</td>
                   <td style="padding:8px;border:1px solid #d1d5db">${escapeHtml(action.status)}</td>`
                : `<td style="padding:8px;border:1px solid #d1d5db" colspan="4">—</td>`;
            rows.push(`<tr>
                ${index === 0 ? `<td style="padding:8px;border:1px solid #d1d5db;vertical-align:top">${discussion.position}</td>` : '<td style="border:1px solid #d1d5db"></td>'}
                ${discussionCell}
                ${actionCell}
            </tr>`);
        });
    }

    return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px;border:1px solid #d1d5db;background:#f3f4f6">#</th>
          <th style="text-align:left;padding:8px;border:1px solid #d1d5db;background:#f3f4f6">Discussion</th>
          <th style="text-align:left;padding:8px;border:1px solid #d1d5db;background:#f3f4f6">Action point</th>
          <th style="text-align:left;padding:8px;border:1px solid #d1d5db;background:#f3f4f6">Responsible</th>
          <th style="text-align:left;padding:8px;border:1px solid #d1d5db;background:#f3f4f6">Deadline</th>
          <th style="text-align:left;padding:8px;border:1px solid #d1d5db;background:#f3f4f6">Status</th>
        </tr>
      </thead>
      <tbody>${rows.join('') || '<tr><td colspan="6" style="padding:8px;border:1px solid #d1d5db">No discussions recorded.</td></tr>'}</tbody>
    </table>`;
}

export function minutesEmailHtml(minutes: MailMinutes, intro: string): string {
    return `<div style="font-family:system-ui,sans-serif;color:#111827;line-height:1.5">
      <p>${intro}</p>
      <h2 style="font-size:16px;margin:16px 0 4px">${escapeHtml(minutes.title)}</h2>
      <p style="margin:0 0 12px;color:#4b5563">${escapeHtml(minutes.meeting_number)} · ${formatDay(minutes.starts_at)}${minutes.venue ? ` · ${escapeHtml(minutes.venue)}` : ''}</p>
      ${minutesTableHtml(minutes)}
      <p style="margin-top:16px;color:#6b7280;font-size:12px">Organizer: ${escapeHtml(minutes.organizerName)}</p>
    </div>`;
}

export function actionReminderHtml(opts: {
    meetingTitle: string;
    meetingNumber: string;
    meetingDate: Date | string;
    discussionTitle: string;
    actionText: string;
    dueDate: Date | string;
    others: string[];
    organizerName: string;
    link?: string | null;
}): string {
    const others = opts.others.length
        ? `<p>Also involved: ${escapeHtml(opts.others.join(', '))}</p>`
        : '';
    const link = opts.link
        ? `<p><a href="${escapeHtml(opts.link)}">Open this action</a></p>`
        : '';
    return `<div style="font-family:system-ui,sans-serif;color:#111827;line-height:1.5">
      <p>Action point from <strong>${escapeHtml(opts.meetingTitle)}</strong> (${escapeHtml(opts.meetingNumber)}, ${formatDay(opts.meetingDate)}).</p>
      <p><strong>Discussion:</strong> ${escapeHtml(opts.discussionTitle)}</p>
      <p>${escapeHtml(opts.actionText)}</p>
      <p><strong>Deadline:</strong> ${formatDay(opts.dueDate)}</p>
      ${others}
      <p>Organizer: ${escapeHtml(opts.organizerName)}</p>
      ${link}
    </div>`;
}
