'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import ChatAvatar from './ChatAvatar';
import { displayName, type ChatPerson } from './types';

export default function NewConversationModal({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: (conversationId: string) => void;
}) {
    const { t } = useI18n();
    const m = t.chat;

    const [people, setPeople] = useState<ChatPerson[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const directory = (await api.getChatDirectory()) as ChatPerson[];
                if (!cancelled) setPeople(Array.isArray(directory) ? directory : []);
            } catch {
                if (!cancelled) toast.error(m.errors.directoryFailed);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [m.errors.directoryFailed]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return people;
        return people.filter((person) =>
            `${person.name ?? ''} ${person.email}`.toLowerCase().includes(needle),
        );
    }, [people, query]);

    // One person selected is a DM; more than one needs a name, because a group
    // has no "other person" to take its title from.
    const isGroup = selected.length > 1;

    const toggle = (id: string) => {
        setSelected((prev) =>
            prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id],
        );
    };

    const submit = async () => {
        if (selected.length === 0) return;
        if (isGroup && !title.trim()) {
            toast.error(m.errors.groupNeedsName);
            return;
        }

        setSaving(true);
        try {
            const conversation = (await api.createChatConversation({
                kind: isGroup ? 'group' : 'dm',
                ...(isGroup ? { title: title.trim() } : {}),
                participantIds: selected,
            })) as { id: string };
            onCreated(conversation.id);
        } catch (error) {
            toast.error((error as Error)?.message || m.errors.createFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={m.newConversation.title} onClose={onClose} />

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
                <div className="relative">
                    <Search
                        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                        aria-hidden="true"
                    />
                    <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={m.newConversation.searchPlaceholder}
                        className="min-h-touch w-full rounded-md border border-gray-300 py-2 pe-3 ps-9 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                </div>

                {isGroup && (
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-700">
                            {m.newConversation.groupName}
                        </span>
                        <input
                            type="text"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            maxLength={120}
                            placeholder={m.newConversation.groupNamePlaceholder}
                            className="min-h-touch w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        />
                    </label>
                )}

                {loading ? (
                    <div className="flex justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                ) : filtered.length === 0 ? (
                    <p className="py-6 text-center text-xs text-gray-500">
                        {m.newConversation.noPeople}
                    </p>
                ) : (
                    <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                        {filtered.map((person) => (
                            <li key={person.id}>
                                <label className="flex min-h-touch cursor-pointer items-center gap-2 p-2.5 hover:bg-gray-50">
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(person.id)}
                                        onChange={() => toggle(person.id)}
                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                                    />
                                    <ChatAvatar person={person} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-gray-900">
                                            {displayName(person)}
                                        </span>
                                        <span className="block truncate text-xs text-gray-500">
                                            {person.email}
                                        </span>
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <ModalFooter>
                <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-xs text-gray-500">
                        {selected.length > 0
                            ? formatMessage(m.newConversation.selectedCount, {
                                  count: selected.length,
                              })
                            : m.newConversation.pickSomeone}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={onClose}>
                            {m.actions.cancel}
                        </Button>
                        <Button
                            onClick={() => void submit()}
                            disabled={selected.length === 0 || saving}
                        >
                            {saving ? m.actions.starting : m.newConversation.start}
                        </Button>
                    </div>
                </div>
            </ModalFooter>
        </ModalShell>
    );
}
