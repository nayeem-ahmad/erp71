'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import {
    ACTION_PRIORITIES,
    ATTENDEE_ROLES,
    MEETING_TYPES,
    type Meeting,
    type MeetingActionPriority,
    type MeetingAttendeeRole,
    type MeetingType,
} from './types';

type TeamMember = { userId: string; name: string | null; email: string };

type PersonForm = {
    userId: string;
    name: string;
    email: string;
    organization: string;
};

type AttendeeForm = PersonForm & { role: MeetingAttendeeRole; attended: boolean };

type ActionForm = {
    id?: string;
    description: string;
    person: PersonForm;
    dueDate: string;
    priority: MeetingActionPriority;
    others: PersonForm[];
};

type DiscussionForm = {
    id?: string;
    title: string;
    description: string;
    decision: string;
    actionItems: ActionForm[];
};

const emptyPerson = (): PersonForm => ({ userId: '', name: '', email: '', organization: '' });
const emptyAction = (): ActionForm => ({
    description: '',
    person: emptyPerson(),
    dueDate: '',
    priority: 'NORMAL',
    others: [],
});
const emptyDiscussion = (): DiscussionForm => ({
    title: '',
    description: '',
    decision: '',
    actionItems: [],
});
const emptyAttendee = (): AttendeeForm => ({
    ...emptyPerson(),
    role: 'MEMBER',
    attended: true,
});

function toLocalInput(iso?: string | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function move<T>(list: T[], index: number, direction: -1 | 1): T[] {
    const next = index + direction;
    if (next < 0 || next >= list.length) return list;
    const copy = [...list];
    const [row] = copy.splice(index, 1);
    copy.splice(next, 0, row);
    return copy;
}

function personPayload(person: PersonForm) {
    if (person.userId) return { userId: person.userId, organization: person.organization || undefined };
    return {
        name: person.name.trim(),
        email: person.email.trim(),
        organization: person.organization.trim() || undefined,
    };
}

function isFilledPerson(person: PersonForm) {
    return Boolean(person.userId || person.name.trim());
}

function guestMissingEmail(person: PersonForm) {
    return isFilledPerson(person) && !person.userId && !person.email.trim();
}

export default function MeetingForm({ mode, meeting }: { mode: 'create' | 'edit'; meeting?: Meeting | null }) {
    const { t } = useI18n();
    const m = t.meetings;
    const router = useRouter();
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [saving, setSaving] = useState(false);
    const [title, setTitle] = useState(meeting?.title ?? '');
    const [type, setType] = useState<MeetingType>(meeting?.type ?? 'OTHER');
    const [startsAt, setStartsAt] = useState(toLocalInput(meeting?.starts_at));
    const [endsAt, setEndsAt] = useState(toLocalInput(meeting?.ends_at));
    const [venue, setVenue] = useState(meeting?.venue ?? '');
    const [summary, setSummary] = useState(meeting?.summary ?? '');
    const [attendees, setAttendees] = useState<AttendeeForm[]>(
        meeting?.attendees.map((attendee) => ({
            userId: attendee.user_id ?? '',
            name: attendee.name,
            email: attendee.email ?? '',
            organization: attendee.organization ?? '',
            role: attendee.role,
            attended: attendee.attended,
        })) ?? [],
    );
    const [discussions, setDiscussions] = useState<DiscussionForm[]>(
        meeting?.discussions.map((discussion) => ({
            id: discussion.id,
            title: discussion.title,
            description: discussion.description ?? '',
            decision: discussion.decision ?? '',
            actionItems: discussion.actionItems.map((action) => ({
                id: action.id,
                description: action.description,
                person: {
                    userId: action.assignee_user_id ?? '',
                    name: action.assignee_name,
                    email: action.assignee_email ?? '',
                    organization: action.assignee_org ?? '',
                },
                dueDate: action.due_date.slice(0, 10),
                priority: action.priority,
                others: action.others.map((person) => ({
                    userId: person.user_id ?? '',
                    name: person.name,
                    email: person.email ?? '',
                    organization: person.organization ?? '',
                })),
            })),
        })) ?? [emptyDiscussion()],
    );
    const [error, setError] = useState('');

    useEffect(() => {
        api.getTeamMembers()
            .then((list: unknown) => setMembers(Array.isArray(list) ? list : []))
            .catch(() => setMembers([]));
    }, []);

    const save = async () => {
        setError('');
        if (!title.trim()) {
            setError(m.validation.title);
            return;
        }
        if (!startsAt) {
            setError(m.validation.startsAt);
            return;
        }
        const describedActions = discussions
            .flatMap((discussion) => discussion.actionItems)
            .filter((action) => action.description.trim());
        if (describedActions.some((action) => !action.dueDate)) {
            setError(m.validation.deadline);
            return;
        }
        if (describedActions.some((action) => !isFilledPerson(action.person))) {
            setError(m.validation.responsible);
            return;
        }
        const peopleNeedingEmail = [
            ...attendees,
            ...describedActions.map((action) => action.person),
            ...describedActions.flatMap((action) => action.others),
        ];
        if (peopleNeedingEmail.some(guestMissingEmail)) {
            setError(m.validation.email);
            return;
        }
        setSaving(true);
        try {
            const payload = {
                title: title.trim(),
                type,
                startsAt: new Date(startsAt).toISOString(),
                endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
                venue: venue.trim() || undefined,
                summary: summary.trim() || undefined,
                attendees: attendees.filter(isFilledPerson).map((attendee) => ({
                    ...personPayload(attendee),
                    role: attendee.role,
                    attended: attendee.attended,
                })),
                discussions: discussions
                    .filter((discussion) => discussion.title.trim())
                    .map((discussion) => ({
                        id: discussion.id,
                        title: discussion.title.trim(),
                        description: discussion.description.trim() || undefined,
                        decision: discussion.decision.trim() || undefined,
                        actionItems: discussion.actionItems
                            .filter((action) => action.description.trim())
                            .map((action) => ({
                                id: action.id,
                                description: action.description.trim(),
                                assigneeUserId: action.person.userId || undefined,
                                assigneeName: action.person.name || undefined,
                                assigneeEmail: action.person.email || undefined,
                                assigneeOrg: action.person.organization || undefined,
                                dueDate: action.dueDate,
                                priority: action.priority,
                                others: action.others.filter(isFilledPerson).map((person) => personPayload(person)),
                            })),
                    })),
            };
            const saved = mode === 'edit' && meeting
                ? await api.updateMeeting(meeting.id, payload)
                : await api.createMeeting(payload);
            toast.success(m.saved);
            router.push(routes.meetings.detail(saved.id));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : m.saveFailed;
            setError(message);
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                <h2 className="text-sm font-semibold text-gray-900">{m.sections.details}</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label={m.fields.title} required>
                        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                    </Field>
                    <Field label={m.fields.type}>
                        <Select value={type} onChange={(e) => setType(e.target.value as MeetingType)}>
                            {MEETING_TYPES.map((value) => (
                                <option key={value} value={value}>{m.types[value]}</option>
                            ))}
                        </Select>
                    </Field>
                    <Field label={m.fields.startsAt} required>
                        <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                    </Field>
                    <Field label={m.fields.endsAt}>
                        <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                    </Field>
                    <Field label={m.fields.venue} className="md:col-span-2">
                        <Input value={venue} onChange={(e) => setVenue(e.target.value)} />
                    </Field>
                    <Field label={m.fields.summary} className="md:col-span-2">
                        <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
                    </Field>
                </div>
            </section>

            <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-900">{m.sections.attendees}</h2>
                    <Button type="button" variant="secondary" onClick={() => setAttendees((rows) => [...rows, emptyAttendee()])}>
                        <Plus className="h-4 w-4" /> {m.addAttendee}
                    </Button>
                </div>
                {attendees.length === 0 ? <p className="text-sm text-gray-500">{m.emptyAttendees}</p> : null}
                <div className="space-y-3">
                    {attendees.map((attendee, index) => (
                        <div key={index} className="grid grid-cols-1 gap-2 rounded-md border border-gray-100 p-3 md:grid-cols-6">
                            <PersonFields
                                person={attendee}
                                members={members}
                                labels={m}
                                onChange={(person) => setAttendees((rows) => rows.map((row, i) => (i === index ? { ...row, ...person } : row)))}
                            />
                            <Field label={m.fields.role}>
                                <Select
                                    value={attendee.role}
                                    onChange={(e) => setAttendees((rows) => rows.map((row, i) => (i === index ? { ...row, role: e.target.value as MeetingAttendeeRole } : row)))}
                                >
                                    {ATTENDEE_ROLES.map((role) => (
                                        <option key={role} value={role}>{m.roles[role]}</option>
                                    ))}
                                </Select>
                            </Field>
                            <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    checked={attendee.attended}
                                    onChange={(e) => setAttendees((rows) => rows.map((row, i) => (i === index ? { ...row, attended: e.target.checked } : row)))}
                                />
                                {m.present}
                            </label>
                            <div className="flex items-end">
                                <Button type="button" variant="ghost" onClick={() => setAttendees((rows) => rows.filter((_, i) => i !== index))}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-900">{m.sections.discussions}</h2>
                    <Button type="button" variant="secondary" onClick={() => setDiscussions((rows) => [...rows, emptyDiscussion()])}>
                        <Plus className="h-4 w-4" /> {m.addDiscussion}
                    </Button>
                </div>
                {discussions.map((discussion, dIndex) => (
                    <div key={discussion.id ?? `new-${dIndex}`} className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                        <div className="flex items-start justify-between gap-2">
                            <Field label={`${m.fields.discussion} ${dIndex + 1}`} className="flex-1" required>
                                <Input
                                    value={discussion.title}
                                    onChange={(e) => setDiscussions((rows) => rows.map((row, i) => (i === dIndex ? { ...row, title: e.target.value } : row)))}
                                />
                            </Field>
                            <div className="mt-6 flex gap-1">
                                <Button type="button" variant="ghost" onClick={() => setDiscussions((rows) => move(rows, dIndex, -1))} aria-label={m.moveUp}>
                                    <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button type="button" variant="ghost" onClick={() => setDiscussions((rows) => move(rows, dIndex, 1))} aria-label={m.moveDown}>
                                    <ArrowDown className="h-4 w-4" />
                                </Button>
                                <Button type="button" variant="ghost" onClick={() => setDiscussions((rows) => rows.filter((_, i) => i !== dIndex))}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                        <Field label={m.fields.description}>
                            <Textarea
                                value={discussion.description}
                                onChange={(e) => setDiscussions((rows) => rows.map((row, i) => (i === dIndex ? { ...row, description: e.target.value } : row)))}
                                rows={2}
                            />
                        </Field>
                        <Field label={m.fields.decision}>
                            <Textarea
                                value={discussion.decision}
                                onChange={(e) => setDiscussions((rows) => rows.map((row, i) => (i === dIndex ? { ...row, decision: e.target.value } : row)))}
                                rows={2}
                            />
                        </Field>
                        <div className="space-y-2">
                            {discussion.actionItems.map((action, aIndex) => (
                                <div key={action.id ?? `a-${aIndex}`} className="space-y-2 rounded-md border border-gray-100 p-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-medium text-gray-500">{dIndex + 1}.{aIndex + 1}</p>
                                        <div className="flex gap-1">
                                            <Button type="button" variant="ghost" onClick={() => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? { ...row, actionItems: move(row.actionItems, aIndex, -1) } : row))}>
                                                <ArrowUp className="h-4 w-4" />
                                            </Button>
                                            <Button type="button" variant="ghost" onClick={() => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? { ...row, actionItems: move(row.actionItems, aIndex, 1) } : row))}>
                                                <ArrowDown className="h-4 w-4" />
                                            </Button>
                                            <Button type="button" variant="ghost" onClick={() => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? { ...row, actionItems: row.actionItems.filter((_, j) => j !== aIndex) } : row))}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                    <Field label={m.fields.action} required>
                                        <Textarea
                                            value={action.description}
                                            onChange={(e) => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? { ...row, actionItems: row.actionItems.map((item, j) => j === aIndex ? { ...item, description: e.target.value } : item) } : row))}
                                            rows={2}
                                        />
                                    </Field>
                                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                        <PersonFields
                                            person={action.person}
                                            members={members}
                                            labels={m}
                                            onChange={(person) => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? { ...row, actionItems: row.actionItems.map((item, j) => j === aIndex ? { ...item, person } : item) } : row))}
                                        />
                                        <Field label={m.fields.deadline} required>
                                            <Input
                                                type="date"
                                                value={action.dueDate}
                                                onChange={(e) => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? { ...row, actionItems: row.actionItems.map((item, j) => j === aIndex ? { ...item, dueDate: e.target.value } : item) } : row))}
                                            />
                                        </Field>
                                        <Field label={m.fields.priority}>
                                            <Select
                                                value={action.priority}
                                                onChange={(e) => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? { ...row, actionItems: row.actionItems.map((item, j) => j === aIndex ? { ...item, priority: e.target.value as MeetingActionPriority } : item) } : row))}
                                            >
                                                {ACTION_PRIORITIES.map((value) => (
                                                    <option key={value} value={value}>{m.priorities[value]}</option>
                                                ))}
                                            </Select>
                                        </Field>
                                    </div>
                                    {action.others.map((other, oIndex) => (
                                        <div key={oIndex} className="grid grid-cols-1 gap-2 md:grid-cols-4">
                                            <PersonFields
                                                person={other}
                                                members={members}
                                                labels={m}
                                                onChange={(person) => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? {
                                                    ...row,
                                                    actionItems: row.actionItems.map((item, j) => j === aIndex ? {
                                                        ...item,
                                                        others: item.others.map((entry, k) => k === oIndex ? person : entry),
                                                    } : item),
                                                } : row))}
                                            />
                                            <div className="flex items-end">
                                                <Button type="button" variant="ghost" onClick={() => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? {
                                                    ...row,
                                                    actionItems: row.actionItems.map((item, j) => j === aIndex ? {
                                                        ...item,
                                                        others: item.others.filter((_, k) => k !== oIndex),
                                                    } : item),
                                                } : row))}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={() => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? {
                                            ...row,
                                            actionItems: row.actionItems.map((item, j) => j === aIndex ? { ...item, others: [...item.others, emptyPerson()] } : item),
                                        } : row))}
                                    >
                                        <Plus className="h-4 w-4" /> {m.addPerson}
                                    </Button>
                                </div>
                            ))}
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setDiscussions((rows) => rows.map((row, i) => i === dIndex ? { ...row, actionItems: [...row.actionItems, emptyAction()] } : row))}
                            >
                                <Plus className="h-4 w-4" /> {m.addAction}
                            </Button>
                        </div>
                    </div>
                ))}
            </section>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => router.push(routes.meetings.root)}>
                    {m.cancel}
                </Button>
                <Button type="button" onClick={() => void save()} disabled={saving}>
                    {saving ? m.saving : m.saveDraft}
                </Button>
            </div>
        </div>
    );
}

function PersonFields({
    person,
    members,
    labels,
    onChange,
}: {
    person: PersonForm;
    members: TeamMember[];
    labels: {
        fields: { person: string; guest: string; name: string; email: string; organization: string };
    };
    onChange: (person: PersonForm) => void;
}) {
    return (
        <>
            <Field label={labels.fields.person} className="md:col-span-2">
                <Select
                    value={person.userId || 'guest'}
                    onChange={(e) => {
                        const value = e.target.value;
                        if (value === 'guest') {
                            onChange({ ...person, userId: '' });
                            return;
                        }
                        const member = members.find((row) => row.userId === value);
                        onChange({
                            userId: value,
                            name: member?.name || member?.email || '',
                            email: member?.email || '',
                            organization: person.organization,
                        });
                    }}
                >
                    <option value="guest">{labels.fields.guest}</option>
                    {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                            {member.name || member.email}
                        </option>
                    ))}
                </Select>
            </Field>
            {!person.userId ? (
                <>
                    <Field label={labels.fields.name}>
                        <Input value={person.name} onChange={(e) => onChange({ ...person, name: e.target.value })} />
                    </Field>
                    <Field label={labels.fields.email}>
                        <Input type="email" value={person.email} onChange={(e) => onChange({ ...person, email: e.target.value })} />
                    </Field>
                    <Field label={labels.fields.organization}>
                        <Input value={person.organization} onChange={(e) => onChange({ ...person, organization: e.target.value })} />
                    </Field>
                </>
            ) : null}
        </>
    );
}
