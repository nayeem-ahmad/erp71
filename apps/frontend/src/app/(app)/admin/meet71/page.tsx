'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import {
    Button,
    CompactSection,
    ConfirmDialog,
    Field,
    Input,
    PageShell,
    Switch,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';

type AllowEntry = { id: string; pattern: string; kind: string };
type Member = {
    email: string;
    displayName: string | null;
    isAdmin: boolean;
    canCreateRoom: boolean;
    inviteQuota: number;
    invitesUsed: number;
};
type Denial = { email: string };

function coveringDomain(email: string, entries: AllowEntry[]): string | null {
    const e = email.trim().toLowerCase();
    const hit = entries.find((row) => {
        const a = row.pattern.trim().toLowerCase();
        return a.startsWith('@') && e.endsWith(a);
    });
    return hit?.pattern ?? null;
}

export default function AdminMeet71Page() {
    const { t } = useI18n();
    const m = t.admin.meet71;

    const [entries, setEntries] = useState<AllowEntry[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [denials, setDenials] = useState<Denial[]>([]);
    const [loading, setLoading] = useState(true);
    const [pattern, setPattern] = useState('');
    const [adding, setAdding] = useState(false);
    const [quotas, setQuotas] = useState<Record<string, string>>({});
    const [roomCode, setRoomCode] = useState('');
    const [roomOwner, setRoomOwner] = useState('');
    const [deleting, setDeleting] = useState<Member | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getMeet71Admin();
            setEntries(data?.entries ?? []);
            setMembers(data?.members ?? []);
            setDenials(data?.denials ?? []);
            const next: Record<string, string> = {};
            for (const member of data?.members ?? []) {
                next[member.email] = String(member.inviteQuota);
            }
            setQuotas(next);
        } catch (error) {
            toast.error((error as Error).message || m.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [m.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    async function handleAddAllowlist(event: FormEvent) {
        event.preventDefault();
        const value = pattern.trim();
        if (!value) return;
        setAdding(true);
        try {
            await api.addMeet71Allowlist(value);
            toast.success(m.allowlist.added);
            setPattern('');
            await load();
        } catch (error) {
            if (error instanceof ApiError && error.code === 'MEET71_DENIED') {
                toast.error(m.allowlist.denied);
            } else {
                toast.error((error as Error).message);
            }
        } finally {
            setAdding(false);
        }
    }

    async function handleRemoveAllowlist(id: string) {
        try {
            await api.deleteMeet71Allowlist(id);
            toast.success(m.allowlist.removed);
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    }

    async function handlePatchMember(
        email: string,
        patch: { canCreateRoom?: boolean; inviteQuota?: number; isAdmin?: boolean },
    ) {
        try {
            await api.patchMeet71Member(email, patch);
            if (patch.inviteQuota !== undefined) toast.success(m.members.quotaSaved);
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    }

    async function handleDeleteMember() {
        if (!deleting) return;
        try {
            await api.deleteMeet71Member(deleting.email);
            toast.success(m.members.deleted);
            setDeleting(null);
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    }

    async function handleUnblock(email: string) {
        try {
            await api.deleteMeet71Denial(email);
            toast.success(m.denials.unblocked);
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    }

    async function handleTransferRoom(event: FormEvent) {
        event.preventDefault();
        const code = roomCode.trim();
        const email = roomOwner.trim();
        if (!code || !email) return;
        try {
            await api.patchMeet71Room(code, email);
            toast.success(m.rooms.saved);
            setRoomCode('');
            setRoomOwner('');
        } catch (error) {
            toast.error((error as Error).message);
        }
    }

    const deleteDomain = deleting ? coveringDomain(deleting.email, entries) : null;
    const deletePrompt = deleting
        ? [
              formatMessage(m.members.deletePrompt, { email: deleting.email }),
              deleteDomain ? formatMessage(m.members.deleteDomainPrompt, { domain: deleteDomain }) : '',
          ]
              .filter(Boolean)
              .join('\n\n')
        : '';

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={m.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        m.title,
                        'admin',
                    )}
                />

                <CompactSection title={m.allowlist.title} titleStyle="heading">
                    <form onSubmit={handleAddAllowlist} className="mb-3 flex flex-wrap items-end gap-2">
                        <Field label={m.allowlist.patternLabel} htmlFor="meet71-pattern" className="min-w-[16rem] flex-1">
                            <Input
                                id="meet71-pattern"
                                value={pattern}
                                onChange={(event) => setPattern(event.target.value)}
                                placeholder={m.allowlist.patternPlaceholder}
                            />
                        </Field>
                        <Button type="submit" size="sm" disabled={adding || !pattern.trim()}>
                            {m.allowlist.add}
                        </Button>
                    </form>
                    {loading && entries.length === 0 ? (
                        <p className="text-sm text-gray-500">{t.common.loading}</p>
                    ) : entries.length === 0 ? (
                        <p className="text-sm text-gray-500">{m.allowlist.empty}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-start text-xs text-gray-500">
                                        <th className="py-1.5 pe-3 font-medium">{m.allowlist.columns.pattern}</th>
                                        <th className="py-1.5 pe-3 font-medium">{m.allowlist.columns.kind}</th>
                                        <th className="py-1.5 font-medium">{t.common.actions}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {entries.map((entry) => (
                                        <tr key={entry.id} className="border-t border-gray-100">
                                            <td className="py-2 pe-3 font-medium text-gray-900">{entry.pattern}</td>
                                            <td className="py-2 pe-3 text-gray-600">
                                                {m.allowlist.kinds[entry.kind as 'EMAIL' | 'DOMAIN'] ?? entry.kind}
                                            </td>
                                            <td className="py-2">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={m.allowlist.remove}
                                                    onClick={() => void handleRemoveAllowlist(entry.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CompactSection>

                <CompactSection title={m.members.title} titleStyle="heading">
                    {loading && members.length === 0 ? (
                        <p className="text-sm text-gray-500">{t.common.loading}</p>
                    ) : members.length === 0 ? (
                        <p className="text-sm text-gray-500">{m.members.empty}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-start text-xs text-gray-500">
                                        <th className="py-1.5 pe-3 font-medium">{m.members.columns.email}</th>
                                        <th className="hidden py-1.5 pe-3 font-medium md:table-cell">{m.members.columns.name}</th>
                                        <th className="py-1.5 pe-3 font-medium">{m.members.columns.admin}</th>
                                        <th className="py-1.5 pe-3 font-medium">{m.members.columns.createRoom}</th>
                                        <th className="py-1.5 pe-3 font-medium">{m.members.columns.inviteQuota}</th>
                                        <th className="hidden py-1.5 pe-3 font-medium md:table-cell">{m.members.columns.used}</th>
                                        <th className="py-1.5 font-medium">{t.common.actions}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {members.map((member) => (
                                        <tr key={member.email} className="border-t border-gray-100">
                                            <td className="py-2 pe-3 font-medium text-gray-900">{member.email}</td>
                                            <td className="hidden py-2 pe-3 text-gray-600 md:table-cell">
                                                {member.displayName || '—'}
                                            </td>
                                            <td className="py-2 pe-3">
                                                <Switch
                                                    checked={member.isAdmin}
                                                    aria-label={m.members.columns.admin}
                                                    onCheckedChange={(checked) =>
                                                        void handlePatchMember(member.email, { isAdmin: checked })
                                                    }
                                                />
                                            </td>
                                            <td className="py-2 pe-3">
                                                <Switch
                                                    checked={member.canCreateRoom}
                                                    aria-label={m.members.columns.createRoom}
                                                    onCheckedChange={(checked) =>
                                                        void handlePatchMember(member.email, { canCreateRoom: checked })
                                                    }
                                                />
                                            </td>
                                            <td className="py-2 pe-3">
                                                <form
                                                    className="flex items-center gap-1"
                                                    onSubmit={(event) => {
                                                        event.preventDefault();
                                                        const value = Number(quotas[member.email]);
                                                        if (!Number.isFinite(value)) return;
                                                        void handlePatchMember(member.email, { inviteQuota: value });
                                                    }}
                                                >
                                                    <Input
                                                        type="number"
                                                        className="w-20"
                                                        value={quotas[member.email] ?? ''}
                                                        onChange={(event) =>
                                                            setQuotas((current) => ({
                                                                ...current,
                                                                [member.email]: event.target.value,
                                                            }))
                                                        }
                                                        aria-label={m.members.columns.inviteQuota}
                                                    />
                                                    <Button type="submit" size="sm" variant="secondary">
                                                        {m.members.saveQuota}
                                                    </Button>
                                                </form>
                                                {member.inviteQuota === -1 && (
                                                    <p className="mt-0.5 text-xs text-gray-400">{m.members.unlimited}</p>
                                                )}
                                            </td>
                                            <td className="hidden py-2 pe-3 text-gray-600 md:table-cell">{member.invitesUsed}</td>
                                            <td className="py-2">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={m.members.delete}
                                                    onClick={() => setDeleting(member)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CompactSection>

                <CompactSection title={m.denials.title} titleStyle="heading">
                    {denials.length === 0 ? (
                        <p className="text-sm text-gray-500">{m.denials.empty}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-start text-xs text-gray-500">
                                        <th className="py-1.5 pe-3 font-medium">{m.denials.columns.email}</th>
                                        <th className="py-1.5 font-medium">{t.common.actions}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {denials.map((row) => (
                                        <tr key={row.email} className="border-t border-gray-100">
                                            <td className="py-2 pe-3 font-medium text-gray-900">{row.email}</td>
                                            <td className="py-2">
                                                <Button type="button" size="sm" variant="secondary" onClick={() => void handleUnblock(row.email)}>
                                                    {m.denials.unblock}
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CompactSection>

                <CompactSection title={m.rooms.title} titleStyle="heading">
                    <form onSubmit={handleTransferRoom} className="flex flex-wrap items-end gap-2">
                        <Field label={m.rooms.codeLabel} htmlFor="meet71-room-code" className="min-w-[10rem]">
                            <Input
                                id="meet71-room-code"
                                value={roomCode}
                                onChange={(event) => setRoomCode(event.target.value)}
                            />
                        </Field>
                        <Field label={m.rooms.emailLabel} htmlFor="meet71-room-owner" className="min-w-[16rem] flex-1">
                            <Input
                                id="meet71-room-owner"
                                type="email"
                                value={roomOwner}
                                onChange={(event) => setRoomOwner(event.target.value)}
                            />
                        </Field>
                        <Button type="submit" size="sm" disabled={!roomCode.trim() || !roomOwner.trim()}>
                            {m.rooms.save}
                        </Button>
                    </form>
                </CompactSection>
            </div>

            <ConfirmDialog
                open={Boolean(deleting)}
                title={m.members.deleteTitle}
                prompt={deletePrompt}
                confirmLabel={m.members.confirmDelete}
                cancelLabel={m.members.cancel}
                danger
                onConfirm={() => void handleDeleteMember()}
                onCancel={() => setDeleting(null)}
            />
        </PageShell>
    );
}
