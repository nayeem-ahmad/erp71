'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { AiCreateDraft, AiDraftChoice } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import Button from '@/components/ui/compact/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

function emailOk(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function assigneeValueOf(draft: AiCreateDraft): string {
    if (draft.fields.assigneeId) return `user:${draft.fields.assigneeId}`;
    if (draft.fields.assigneeEmployeeId) return `employee:${draft.fields.assigneeEmployeeId}`;
    if (draft.fields.assigneeUnresolved) return '';
    return 'unassigned';
}

function splitAssignee(value: string): { assigneeId?: string; assigneeEmployeeId?: string } {
    if (!value || value === 'unassigned') return {};
    const colon = value.indexOf(':');
    if (colon < 0) return {};
    const kind = value.slice(0, colon);
    const id = value.slice(colon + 1);
    if (!id) return {};
    if (kind === 'employee') return { assigneeEmployeeId: id };
    if (kind === 'user') return { assigneeId: id };
    return {};
}

function flagKey(messageId: string, index: number): string {
    return `erp71.aiDraft.${messageId}.${index}`;
}

/**
 * The confirmation card for a task or lead the assistant understood.
 * Save calls the same endpoints the screens use. Cancel discards the card
 * in this browser tab. Nothing is written before one of those two.
 */
export default function AiCreateDraftCard({
    messageId,
    index,
    draft,
}: {
    messageId: string;
    index: number;
    draft: AiCreateDraft;
}) {
    const { t } = useI18n();
    const m = t.components.aiChatWidget.draft;
    const fields = draft.fields;
    const [title, setTitle] = useState(fields.title ?? '');
    const [description, setDescription] = useState(fields.description ?? '');
    const [projectId, setProjectId] = useState(fields.projectId ?? '');
    const [assignee, setAssignee] = useState(assigneeValueOf(draft));
    const [dueDate, setDueDate] = useState(fields.dueDate ?? '');
    const [priority, setPriority] = useState(fields.priority ?? 'MEDIUM');
    const [name, setName] = useState(fields.name ?? '');
    const [mobile, setMobile] = useState(fields.mobile ?? '');
    const [email, setEmail] = useState(fields.email ?? '');
    const [remarks, setRemarks] = useState(fields.remarks ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [disposition, setDisposition] = useState<'open' | 'saved' | 'cancelled'>('open');
    const [savedId, setSavedId] = useState<string | null>(null);

    useEffect(() => {
        const raw = sessionStorage.getItem(flagKey(messageId, index));
        if (raw === 'cancelled') setDisposition('cancelled');
        else if (raw?.startsWith('saved:')) {
            setDisposition('saved');
            setSavedId(raw.slice('saved:'.length) || null);
        }
    }, [index, messageId]);

    if (disposition === 'cancelled') return null;

    const projectChoices = fields.projectChoices ?? [];
    const assigneeChoices = fields.assigneeChoices ?? [];
    const taskReady = title.trim().length > 0 && title.trim().length <= 300 && Boolean(projectId) && assignee !== '';
    const leadReady = name.trim().length > 0 && name.trim().length <= 200 && emailOk(email);
    const canSave = draft.kind === 'task' ? taskReady : leadReady;

    const remember = (value: string) => {
        sessionStorage.setItem(flagKey(messageId, index), value);
    };

    const save = async () => {
        if (!canSave || busy) return;
        setBusy(true);
        setError(null);
        try {
            const created = draft.kind === 'task'
                ? await api.createProjectTask({
                    projectId,
                    title: title.trim(),
                    ...(description.trim() ? { description: description.trim() } : {}),
                    ...(dueDate ? { dueDate } : {}),
                    priority,
                    ...splitAssignee(assignee),
                })
                : await api.createLead({
                    name: name.trim(),
                    ...(mobile.trim() ? { mobile: mobile.trim() } : {}),
                    ...(email.trim() ? { email: email.trim() } : {}),
                    ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
                });
            const id = created && typeof created === 'object' && 'id' in created ? String((created as { id: unknown }).id) : '';
            remember(`saved:${id}`);
            setSavedId(id || null);
            setDisposition('saved');
            toast.success(draft.kind === 'task' ? m.savedTask : m.savedLead);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.saveError);
        } finally {
            setBusy(false);
        }
    };

    if (disposition === 'saved') {
        const href = draft.kind === 'task'
            ? (savedId ? routes.projects.taskDetail(savedId) : routes.projects.tasks)
            : (savedId ? routes.crm.leadDetail(savedId) : routes.crm.leads);
        return (
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700">
                <p>{draft.kind === 'task' ? m.savedTask : m.savedLead}</p>
                <Link href={href} className="mt-1 inline-block text-blue-600 hover:underline">
                    {draft.kind === 'task' ? m.openTask : m.openLead}
                </Link>
            </div>
        );
    }

    return (
        <form
            className="space-y-2 rounded-lg border border-gray-200 bg-white p-3"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
        >
            <div>
                <p className="text-sm font-semibold text-gray-900">
                    {draft.kind === 'task' ? m.taskTitle : m.leadTitle}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">{m.review}</p>
            </div>

            {draft.kind === 'task' ? (
                <>
                    <Field label={m.title} required={!title.trim()}>
                        <Input value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} error={!title.trim()} />
                    </Field>
                    <Field label={m.description}>
                        <textarea
                            value={description}
                            maxLength={5000}
                            rows={2}
                            onChange={(event) => setDescription(event.target.value)}
                            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </Field>
                    <Field label={m.project} required={!projectId}>
                        {projectChoices.length === 0 && !projectId ? (
                            <p className="text-xs text-red-600">{m.noProjects}</p>
                        ) : (
                            <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} error={!projectId}>
                                <option value="">{m.projectPlaceholder}</option>
                                {withCurrent(projectChoices, projectId, fields.projectName).map((choice) => (
                                    <option key={choice.id} value={choice.id}>
                                        {choice.detail ? `${choice.label} (${choice.detail})` : choice.label}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </Field>
                    <Field label={m.assignee} required={assignee === ''}>
                        <Select value={assignee} onChange={(event) => setAssignee(event.target.value)} error={assignee === ''}>
                            {assignee === '' ? <option value="">{m.chooseAssignee}</option> : null}
                            <option value="unassigned">{m.unassigned}</option>
                            {assigneeChoices.map((choice) => (
                                <option key={`${choice.kind ?? 'user'}:${choice.id}`} value={`${choice.kind ?? 'user'}:${choice.id}`}>
                                    {choice.detail ? `${choice.label} (${choice.detail})` : choice.label}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                        <Field label={m.dueDate}>
                            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                        </Field>
                        <Field label={m.priority}>
                            <Select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
                                <option value="LOW">{m.priorityLow}</option>
                                <option value="MEDIUM">{m.priorityMedium}</option>
                                <option value="HIGH">{m.priorityHigh}</option>
                                <option value="URGENT">{m.priorityUrgent}</option>
                            </Select>
                        </Field>
                    </div>
                </>
            ) : (
                <>
                    <Field label={m.name} required={!name.trim()}>
                        <Input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} error={!name.trim()} />
                    </Field>
                    <Field label={m.phone}>
                        <Input value={mobile} maxLength={40} onChange={(event) => setMobile(event.target.value)} />
                    </Field>
                    <Field label={m.email} required={Boolean(email.trim()) && !emailOk(email)}>
                        <Input
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            error={Boolean(email.trim()) && !emailOk(email)}
                        />
                    </Field>
                    <Field label={m.note}>
                        <textarea
                            value={remarks}
                            maxLength={5000}
                            rows={2}
                            onChange={(event) => setRemarks(event.target.value)}
                            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </Field>
                    <p className="text-[11px] text-gray-500">{m.companyHint}</p>
                    <p className="text-xs text-gray-600">
                        {m.owner}: <span className="font-medium text-gray-900">{m.ownerYou}</span>
                    </p>
                </>
            )}

            {error ? <p className="text-xs text-red-600">{error}</p> : null}

            <div className="flex items-center gap-2 pt-1">
                <Button type="submit" disabled={!canSave || busy} loading={busy}>
                    {busy ? m.saving : m.save}
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                        remember('cancelled');
                        setDisposition('cancelled');
                    }}
                >
                    {m.cancel}
                </Button>
            </div>
        </form>
    );
}

function Field({
    label,
    required,
    children,
}: {
    label: string;
    required?: boolean;
    children: ReactNode;
}) {
    return (
        <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-700">
                {label}
                {required ? <span className="text-red-600"> *</span> : null}
            </span>
            {children}
        </label>
    );
}

/** Keep a resolved id selectable even if it is missing from the choice list. */
function withCurrent(choices: AiDraftChoice[], id: string, name?: string): AiDraftChoice[] {
    if (!id || choices.some((choice) => choice.id === id)) return choices;
    return [{ id, label: name || id }, ...choices];
}
