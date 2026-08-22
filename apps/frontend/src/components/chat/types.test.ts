import { displayName, initialsFor, seenReceiptMessageId, type ChatMessage } from './types';

describe('displayName', () => {
    it('prefers the name and falls back to the email', () => {
        expect(displayName({ name: 'Karim Rahman', email: 'k@x.com' })).toBe('Karim Rahman');
        expect(displayName({ name: '   ', email: 'k@x.com' })).toBe('k@x.com');
        expect(displayName({ name: null, email: 'k@x.com' })).toBe('k@x.com');
    });
});

describe('initialsFor', () => {
    it('uses the first and last name', () => {
        expect(initialsFor({ name: 'Karim Rahman' })).toBe('KR');
        expect(initialsFor({ name: 'Ayesha Binte Noor' })).toBe('AN');
    });

    it('takes two letters from a single word', () => {
        expect(initialsFor({ name: 'Karim' })).toBe('KA');
    });

    it('falls back to the email when there is no name', () => {
        expect(initialsFor({ name: null, email: 'karim@x.com' })).toBe('KA');
    });

    it('never returns an empty monogram', () => {
        expect(initialsFor({ name: null, email: null })).toBe('?');
    });
});

describe('seenReceiptMessageId', () => {
    const me = 'user-1';
    const peer = (lastReadAt: string | null) => ({
        id: 'conv-1',
        kind: 'dm' as const,
        title: 'Ayesha',
        archived: false,
        lastMessageAt: null,
        lastMessagePreview: null,
        participants: [
            { id: me, name: 'Karim', email: 'k@x.com', avatarUrl: null, role: 'member', lastReadAt: null },
            {
                id: 'user-2',
                name: 'Ayesha',
                email: 'a@x.com',
                avatarUrl: null,
                role: 'member',
                lastReadAt,
            },
        ],
    });

    const message = (over: Partial<ChatMessage> & { id: string; createdAt: string }): ChatMessage => ({
        conversationId: 'conv-1',
        kind: 'text',
        body: 'hi',
        deleted: false,
        editedAt: null,
        sender: { id: me, name: 'Karim', email: 'k@x.com', avatarUrl: null },
        attachments: [],
        ...over,
    });

    const thread = [
        message({ id: 'm1', createdAt: '2026-08-22T09:00:00.000Z' }),
        message({ id: 'm2', createdAt: '2026-08-22T09:10:00.000Z' }),
        message({ id: 'm3', createdAt: '2026-08-22T09:50:00.000Z' }),
    ];

    it('marks the newest of my messages at or before their cursor', () => {
        expect(seenReceiptMessageId(thread, me, peer('2026-08-22T09:30:00.000Z'))).toBe('m2');
    });

    it('returns null when they have never opened the thread', () => {
        expect(seenReceiptMessageId(thread, me, peer(null))).toBeNull();
    });

    it('ignores their own messages — a receipt is only ever on mine', () => {
        const mixed = [
            message({ id: 'mine', createdAt: '2026-08-22T09:00:00.000Z' }),
            message({
                id: 'theirs',
                createdAt: '2026-08-22T09:20:00.000Z',
                sender: { id: 'user-2', name: 'Ayesha', email: 'a@x.com', avatarUrl: null },
            }),
        ];
        expect(seenReceiptMessageId(mixed, me, peer('2026-08-22T09:30:00.000Z'))).toBe('mine');
    });

    it('skips deleted and system messages', () => {
        const noisy = [
            message({ id: 'text', createdAt: '2026-08-22T09:00:00.000Z' }),
            message({ id: 'gone', createdAt: '2026-08-22T09:05:00.000Z', deleted: true }),
            message({ id: 'sys', createdAt: '2026-08-22T09:06:00.000Z', kind: 'system' }),
        ];
        expect(seenReceiptMessageId(noisy, me, peer('2026-08-22T09:30:00.000Z'))).toBe('text');
    });

    it('stays quiet in groups, where one label cannot say who saw it', () => {
        const group = { ...peer('2026-08-22T09:30:00.000Z'), kind: 'group' as const };
        expect(seenReceiptMessageId(thread, me, group)).toBeNull();
    });

    it('returns null before the current user is known', () => {
        expect(seenReceiptMessageId(thread, null, peer('2026-08-22T09:30:00.000Z'))).toBeNull();
    });
});
