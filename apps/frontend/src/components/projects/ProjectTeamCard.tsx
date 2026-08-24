'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Select, Field } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

export interface ProjectMember {
    id: string;
    role: string;
    user?: { id: string; name?: string | null; email: string } | null;
    employee?: { id: string; name: string; employee_code: string } | null;
}

/**
 * One row in the picker, as `/projects/member-candidates` returns it — users
 * and login-less employees already merged and de-duplicated server-side.
 */
interface Candidate {
    key: string;
    name: string;
    hint: string;
    userId?: string;
    employeeId?: string;
    /** An employee with no account cannot log in, so this is worth showing. */
    noLogin: boolean;
}

export function memberName(member: ProjectMember): string {
    if (member.user) return member.user.name || member.user.email;
    return member.employee?.name ?? '—';
}

export default function ProjectTeamCard({
    projectId,
    members,
    isPrivate = false,
    onChanged,
}: {
    projectId: string;
    members: ProjectMember[];
    /** On a private project this list *is* the access list — say so. */
    isPrivate?: boolean;
    onChanged: () => void | Promise<void>;
}) {
    const { t } = useI18n();
    const m = t.projects;

    const [open, setOpen] = useState(false);
    const [directory, setDirectory] = useState<Candidate[]>([]);
    const [picked, setPicked] = useState('');
    const [role, setRole] = useState('MEMBER');
    const [saving, setSaving] = useState(false);

    const loadDirectory = useCallback(() => {
        api.getProjectMemberCandidates()
            .then((res: unknown) => setDirectory((Array.isArray(res) ? res : []) as Candidate[]))
            .catch(() => setDirectory([]));
    }, []);

    useEffect(() => {
        if (open) loadDirectory();
    }, [open, loadDirectory]);

    /** Whoever is already on the project is dropped; the rest is as served. */
    const candidates = useMemo<Candidate[]>(() => {
        const takenUsers = new Set(members.map((mem) => mem.user?.id).filter(Boolean));
        const takenEmployees = new Set(members.map((mem) => mem.employee?.id).filter(Boolean));

        return directory.filter(
            (c) =>
                !(c.userId && takenUsers.has(c.userId)) &&
                !(c.employeeId && takenEmployees.has(c.employeeId)),
        );
    }, [directory, members]);

    const add = async () => {
        const candidate = candidates.find((c) => c.key === picked);
        if (!candidate) return;
        setSaving(true);
        try {
            await api.addProjectMember(projectId, {
                userId: candidate.userId,
                employeeId: candidate.employeeId,
                role,
            });
            toast.success(m.team.added);
            setOpen(false);
            setPicked('');
            await onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.team.addFailed);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (memberId: string) => {
        try {
            await api.removeProjectMember(projectId, memberId);
            toast.success(m.team.removed);
            await onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.team.removeFailed);
        }
    };

    return (
        <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium">{m.tabs.team}</h2>
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                    <Plus className="h-3.5 w-3.5" />
                    {m.team.add}
                </button>
            </div>

            {isPrivate && <p className="mb-2 text-xs text-gray-500">{m.team.accessNote}</p>}

            {members.length === 0 ? (
                <p className="text-sm text-gray-500">{m.overview.noTeam}</p>
            ) : (
                <ul className="space-y-1.5 text-sm">
                    {members.map((member) => (
                        <li key={member.id} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate">
                                {memberName(member)}
                                {member.employee && (
                                    <span className="ms-1 text-xs text-amber-600">{m.team.noLogin}</span>
                                )}
                            </span>
                            <span className="shrink-0 text-xs text-gray-500">
                                {(m.team[member.role as keyof typeof m.team] as string) ?? member.role}
                            </span>
                            <button
                                type="button"
                                onClick={() => remove(member.id)}
                                title={m.team.remove}
                                className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {open && (
            <ModalShell onBackdropClick={() => setOpen(false)}>
                <ModalHeader title={m.team.add} onClose={() => setOpen(false)} />
                <div className="space-y-3 p-4">
                    <Field label={m.team.person}>
                        <Select value={picked} onChange={(e) => setPicked(e.target.value)}>
                            <option value="">—</option>
                            {candidates.map((c) => (
                                <option key={c.key} value={c.key}>
                                    {c.name} · {c.hint}
                                    {c.noLogin ? ` (${m.team.noLogin})` : ''}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field label={m.team.role}>
                        <Select value={role} onChange={(e) => setRole(e.target.value)}>
                            <option value="MANAGER">{m.team.MANAGER}</option>
                            <option value="MEMBER">{m.team.MEMBER}</option>
                            <option value="VIEWER">{m.team.VIEWER}</option>
                        </Select>
                    </Field>
                    <p className="text-xs text-gray-500">{m.team.noLoginHint}</p>
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setOpen(false)}>
                        {t.common.cancel}
                    </Button>
                    <Button onClick={add} disabled={saving || !picked}>
                        {t.common.save}
                    </Button>
                </ModalFooter>
            </ModalShell>
            )}
        </div>
    );
}
