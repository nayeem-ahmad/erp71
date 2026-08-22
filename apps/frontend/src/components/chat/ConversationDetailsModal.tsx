'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, LogOut, UserMinus, UserPlus } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import ChatAvatar from './ChatAvatar';
import { displayName, type ChatConversation, type ChatPerson } from './types';

export default function ConversationDetailsModal({
    conversation,
    currentUserId,
    onClose,
    onChanged,
    onLeft,
}: {
    conversation: ChatConversation;
    currentUserId: string | null;
    onClose: () => void;
    onChanged: () => void;
    onLeft: () => void;
}) {
    const { t } = useI18n();
    const m = t.chat;

    const isGroup = conversation.kind === 'group';
    const isAdmin = useMemo(
        () =>
            conversation.participants.some(
                (person) => person.id === currentUserId && person.role === 'admin',
            ),
        [conversation.participants, currentUserId],
    );

    const [title, setTitle] = useState(conversation.title);
    const [saving, setSaving] = useState(false);
    const [adding, setAdding] = useState(false);
    const [directory, setDirectory] = useState<ChatPerson[]>([]);
    const [picked, setPicked] = useState<string[]>([]);

    useEffect(() => {
        if (!adding) return;
        let cancelled = false;
        void (async () => {
            try {
                const people = (await api.getChatDirectory()) as ChatPerson[];
                if (!cancelled) setDirectory(Array.isArray(people) ? people : []);
            } catch {
                if (!cancelled) toast.error(m.errors.directoryFailed);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [adding, m.errors.directoryFailed]);

    const memberIds = new Set(conversation.participants.map((person) => person.id));
    const addable = directory.filter((person) => !memberIds.has(person.id));

    const run = async (action: () => Promise<unknown>, failure: string) => {
        setSaving(true);
        try {
            await action();
            onChanged();
            return true;
        } catch (error) {
            toast.error((error as Error)?.message || failure);
            return false;
        } finally {
            setSaving(false);
        }
    };

    const rename = async () => {
        const trimmed = title.trim();
        if (!trimmed || trimmed === conversation.title) return;
        if (await run(() => api.updateChatConversation(conversation.id, { title: trimmed }), m.errors.renameFailed)) {
            toast.success(m.details.renamed);
        }
    };

    const toggleArchive = async () => {
        const archived = !conversation.archived;
        if (await run(() => api.updateChatConversation(conversation.id, { archived }), m.errors.archiveFailed)) {
            toast.success(archived ? m.details.archived : m.details.unarchived);
        }
    };

    const addPicked = async () => {
        if (picked.length === 0) return;
        if (await run(() => api.addChatParticipants(conversation.id, picked), m.errors.addFailed)) {
            setPicked([]);
            setAdding(false);
        }
    };

    const remove = async (userId: string) => {
        const leaving = userId === currentUserId;
        const ok = await run(
            () => api.removeChatParticipant(conversation.id, userId),
            leaving ? m.errors.leaveFailed : m.errors.removeFailed,
        );
        if (ok && leaving) onLeft();
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={m.details.title} onClose={onClose} />

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {isGroup && isAdmin && (
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-700">
                            {m.details.name}
                        </span>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={title}
                                onChange={(event) => setTitle(event.target.value)}
                                maxLength={120}
                                className="min-h-touch flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                            />
                            <Button
                                variant="secondary"
                                onClick={() => void rename()}
                                disabled={saving || !title.trim() || title.trim() === conversation.title}
                            >
                                {m.actions.save}
                            </Button>
                        </div>
                    </label>
                )}

                <div>
                    <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-xs font-medium text-gray-700">{m.details.members}</h3>
                        {isGroup && isAdmin && !adding && (
                            <button
                                type="button"
                                onClick={() => setAdding(true)}
                                className="flex min-h-touch items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                            >
                                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                                {m.details.addPeople}
                            </button>
                        )}
                    </div>

                    <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                        {conversation.participants.map((person) => (
                            <li
                                key={person.id}
                                className="flex min-h-touch items-center gap-2 p-2.5"
                            >
                                <ChatAvatar person={person} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm text-gray-900">
                                        {displayName(person)}
                                        {person.id === currentUserId && (
                                            <span className="ms-1 text-xs text-gray-500">
                                                {m.details.you}
                                            </span>
                                        )}
                                    </span>
                                    <span className="block truncate text-xs text-gray-500">
                                        {person.role === 'admin' && isGroup
                                            ? m.details.adminLabel
                                            : person.email}
                                    </span>
                                </span>
                                {isGroup && isAdmin && person.id !== currentUserId && (
                                    <button
                                        type="button"
                                        onClick={() => void remove(person.id)}
                                        disabled={saving}
                                        aria-label={m.details.removeMember}
                                        className="rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                                    >
                                        <UserMinus className="h-4 w-4" />
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>

                {adding && (
                    <div>
                        <h3 className="mb-2 text-xs font-medium text-gray-700">
                            {m.details.addPeople}
                        </h3>
                        {addable.length === 0 ? (
                            <p className="text-xs text-gray-500">{m.details.everyoneAdded}</p>
                        ) : (
                            <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                                {addable.map((person) => (
                                    <li key={person.id}>
                                        <label className="flex min-h-touch cursor-pointer items-center gap-2 p-2.5 hover:bg-gray-50">
                                            <input
                                                type="checkbox"
                                                checked={picked.includes(person.id)}
                                                onChange={() =>
                                                    setPicked((prev) =>
                                                        prev.includes(person.id)
                                                            ? prev.filter((id) => id !== person.id)
                                                            : [...prev, person.id],
                                                    )
                                                }
                                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                                            />
                                            <span className="truncate text-sm text-gray-900">
                                                {displayName(person)}
                                            </span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="mt-2 flex gap-2">
                            <Button onClick={() => void addPicked()} disabled={picked.length === 0 || saving}>
                                {m.details.add}
                            </Button>
                            <Button variant="secondary" onClick={() => setAdding(false)}>
                                {m.actions.cancel}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <ModalFooter>
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    {isGroup ? (
                        <button
                            type="button"
                            onClick={() => void remove(currentUserId ?? '')}
                            disabled={saving || !currentUserId}
                            className="flex min-h-touch items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                        >
                            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                            {m.details.leaveGroup}
                        </button>
                    ) : (
                        <span />
                    )}
                    <div className="flex gap-2">
                        {isGroup && isAdmin && (
                            <Button variant="secondary" onClick={() => void toggleArchive()} disabled={saving}>
                                {conversation.archived ? m.details.unarchive : m.details.archive}
                            </Button>
                        )}
                        <Button variant="secondary" onClick={onClose}>
                            {m.actions.close}
                        </Button>
                    </div>
                </div>
            </ModalFooter>

            {saving && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                </div>
            )}
        </ModalShell>
    );
}
