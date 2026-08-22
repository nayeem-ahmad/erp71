import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

const NOW = new Date('2026-08-22T10:00:00.000Z');

function makeService(overrides?: { membership?: any }) {
    const membership = overrides?.membership ?? {
        conversationId: 'conv-1',
        kind: 'group',
        title: 'Floor staff',
        archivedAt: null,
        participantId: 'part-1',
        role: 'admin',
        lastReadAt: null,
        mutedUntil: null,
    };

    const tx = {
        chatMessage: {
            create: jest.fn().mockResolvedValue({
                id: 'msg-1',
                conversation_id: 'conv-1',
                sender_id: 'user-1',
                body: 'hello',
                kind: 'text',
                edited_at: null,
                deleted_at: null,
                created_at: NOW,
                sender: { id: 'user-1', name: 'Karim', email: 'k@x.com', avatar_url: null },
                attachments: [],
            }),
        },
        chatConversation: { update: jest.fn().mockResolvedValue({}) },
        chatParticipant: { update: jest.fn().mockResolvedValue({}) },
    };

    const db: any = {
        $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
        chatConversation: {
            findUnique: jest.fn().mockResolvedValue({
                id: 'conv-1',
                kind: 'group',
                title: 'Floor staff',
                archived_at: null,
                created_at: NOW,
                created_by: 'user-1',
                last_message_at: NOW,
                last_message_preview: 'hello',
                participants: [
                    {
                        user_id: 'user-1',
                        role: 'admin',
                        user: { id: 'user-1', name: 'Karim', email: 'k@x.com', avatar_url: null },
                    },
                ],
            }),
            create: jest.fn().mockResolvedValue({ id: 'conv-new' }),
            update: jest.fn().mockResolvedValue({}),
        },
        chatParticipant: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn().mockResolvedValue({}),
            create: jest.fn().mockResolvedValue({}),
        },
        chatMessage: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            groupBy: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue({}),
        },
        chatAttachment: { count: jest.fn().mockResolvedValue(0) },
        tenantUser: { findMany: jest.fn().mockResolvedValue([]) },
        user: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ id: 'user-1', name: 'Karim', email: 'k@x.com' }]),
        },
    };

    const access: any = {
        requireMembership: jest.fn().mockResolvedValue(membership),
        listActiveParticipantIds: jest.fn().mockResolvedValue([]),
        filterTenantMemberIds: jest.fn().mockImplementation((_t: string, ids: string[]) => ids),
    };
    const attachments: any = {
        prepare: jest.fn().mockResolvedValue([]),
        rollback: jest.fn().mockResolvedValue(undefined),
        purgeForMessage: jest.fn().mockResolvedValue(undefined),
    };
    const notifications: any = { create: jest.fn().mockResolvedValue({}) };

    const service = new ChatService(db, access, attachments, notifications);
    return { service, db, tx, access, attachments, notifications };
}

const viewer = { tenantId: 'ten-1', userId: 'user-1' };

describe('ChatService.createConversation', () => {
    it('rejects a conversation with only yourself in it', async () => {
        const { service } = makeService();
        await expect(
            service.createConversation(viewer, { kind: 'dm', participantIds: ['user-1'] }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects participants from outside the workspace', async () => {
        const { service, access } = makeService();
        // A participant from another tenant would straddle two workspaces.
        access.filterTenantMemberIds.mockResolvedValue([]);
        await expect(
            service.createConversation(viewer, { kind: 'dm', participantIds: ['outsider'] }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reuses an existing DM instead of opening a second one', async () => {
        const { service, db } = makeService();
        db.chatConversation.findUnique.mockResolvedValueOnce({ id: 'conv-existing' });

        await service.createConversation(viewer, { kind: 'dm', participantIds: ['user-2'] });
        expect(db.chatConversation.create).not.toHaveBeenCalled();
    });

    it('sorts the dm_key so the pair resolves to one row either way round', async () => {
        const { service, db } = makeService();
        db.chatConversation.findUnique.mockResolvedValueOnce(null);

        await service.createConversation(viewer, { kind: 'dm', participantIds: ['aaa'] });
        expect(db.chatConversation.create.mock.calls[0][0].data.dm_key).toBe('aaa:user-1');
    });

    it('refuses a DM with more than one other person', async () => {
        const { service } = makeService();
        await expect(
            service.createConversation(viewer, { kind: 'dm', participantIds: ['a', 'b'] }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a name for a group', async () => {
        const { service } = makeService();
        await expect(
            service.createConversation(viewer, {
                kind: 'group',
                title: '   ',
                participantIds: ['user-2'],
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('makes the creator an admin and the rest members', async () => {
        const { service, db } = makeService();
        await service.createConversation(viewer, {
            kind: 'group',
            title: 'Floor staff',
            participantIds: ['user-2'],
        });

        const created = db.chatConversation.create.mock.calls[0][0].data.participants.create;
        expect(created).toEqual([
            { user_id: 'user-1', role: 'admin' },
            { user_id: 'user-2', role: 'member' },
        ]);
    });
});

describe('ChatService.sendMessage', () => {
    it('requires membership before anything else', async () => {
        const { service, access } = makeService();
        access.requireMembership.mockRejectedValue(new NotFoundException());

        await expect(
            service.sendMessage(viewer, 'conv-1', { body: 'hi' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a message with neither text nor attachments', async () => {
        const { service } = makeService();
        await expect(
            service.sendMessage(viewer, 'conv-1', { body: '   ' }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows an attachment with no caption', async () => {
        const { service, attachments } = makeService();
        attachments.prepare.mockResolvedValue([
            {
                file_url: 'u',
                file_name: 'f.png',
                mime_type: 'image/png',
                file_size: 1,
                storage_key: 'k',
            },
        ]);

        await expect(
            service.sendMessage(viewer, 'conv-1', {
                body: '',
                attachments: [{ fileBase64: 'x' }],
            }),
        ).resolves.toMatchObject({ id: 'msg-1' });
    });

    it('refuses to post into an archived conversation', async () => {
        const { service } = makeService({
            membership: {
                conversationId: 'conv-1',
                kind: 'group',
                title: 'Old',
                archivedAt: NOW,
                participantId: 'part-1',
                role: 'admin',
                lastReadAt: null,
                mutedUntil: null,
            },
        });
        await expect(
            service.sendMessage(viewer, 'conv-1', { body: 'hi' }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('advances the sender’s own read marker', async () => {
        // Without this the sender's own message comes back unread on the next poll.
        const { service, tx } = makeService();
        await service.sendMessage(viewer, 'conv-1', { body: 'hello' });
        expect(tx.chatParticipant.update).toHaveBeenCalledWith({
            where: { id: 'part-1' },
            data: { last_read_at: NOW },
        });
    });

    it('denormalises the preview onto the conversation', async () => {
        const { service, tx } = makeService();
        await service.sendMessage(viewer, 'conv-1', { body: 'hello' });
        expect(tx.chatConversation.update.mock.calls[0][0].data).toMatchObject({
            last_message_at: NOW,
            last_message_preview: 'hello',
        });
    });

    it('deletes uploaded files when the message row fails to write', async () => {
        const { service, db, attachments } = makeService();
        const prepared = [
            {
                file_url: 'u',
                file_name: 'f.png',
                mime_type: 'image/png',
                file_size: 1,
                storage_key: 'k',
            },
        ];
        attachments.prepare.mockResolvedValue(prepared);
        db.$transaction.mockRejectedValue(new Error('db down'));

        await expect(
            service.sendMessage(viewer, 'conv-1', {
                body: 'hi',
                attachments: [{ fileBase64: 'x' }],
            }),
        ).rejects.toThrow('db down');
        // Otherwise the files are stranded in Cloudinary and billed forever.
        expect(attachments.rollback).toHaveBeenCalledWith(prepared);
    });

    it('still returns the message when notification fan-out fails', async () => {
        const { service, db } = makeService();
        db.chatConversation.findUnique.mockRejectedValue(new Error('boom'));
        // The message is already committed; a missing bell is not worth a 500.
        await expect(
            service.sendMessage(viewer, 'conv-1', { body: 'hello' }),
        ).resolves.toMatchObject({ id: 'msg-1' });
    });
});

describe('ChatService.editMessage / deleteMessage', () => {
    const ownMessage = {
        id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        kind: 'text',
        body: 'hello',
        deleted_at: null,
        created_at: new Date(Date.now() - 1000),
    };

    it('refuses to edit someone else’s message', async () => {
        // Chat has no moderator role — not even an OWNER edits another person's
        // message, which is why this is ownership and not a permission check.
        const { service, db } = makeService();
        db.chatMessage.findFirst.mockResolvedValue({ ...ownMessage, sender_id: 'user-2' });

        await expect(
            service.editMessage(viewer, 'msg-1', { body: 'changed' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to edit outside the edit window', async () => {
        const { service, db } = makeService();
        db.chatMessage.findFirst.mockResolvedValue({
            ...ownMessage,
            created_at: new Date(Date.now() - 60 * 60 * 1000),
        });

        await expect(
            service.editMessage(viewer, 'msg-1', { body: 'changed' }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to edit a system message', async () => {
        const { service, db } = makeService();
        db.chatMessage.findFirst.mockResolvedValue({ ...ownMessage, kind: 'system' });

        await expect(
            service.editMessage(viewer, 'msg-1', { body: 'changed' }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blanks the body rather than only hiding it', async () => {
        const { service, db } = makeService();
        db.chatMessage.findFirst.mockResolvedValue(ownMessage);

        await service.deleteMessage(viewer, 'msg-1');
        // A stored-but-hidden body is one careless select away from resurfacing.
        expect(db.chatMessage.update.mock.calls[0][0].data.body).toBe('');
        expect(db.chatMessage.update.mock.calls[0][0].data.deleted_at).toBeInstanceOf(Date);
    });

    it('removes the stored files when a message is deleted', async () => {
        const { service, db, attachments } = makeService();
        db.chatMessage.findFirst.mockResolvedValue(ownMessage);

        await service.deleteMessage(viewer, 'msg-1');
        expect(attachments.purgeForMessage).toHaveBeenCalledWith('msg-1');
    });

    it('rewrites the conversation preview when the newest message goes', async () => {
        const { service, db } = makeService();
        db.chatMessage.findFirst
            .mockResolvedValueOnce(ownMessage)
            .mockResolvedValueOnce({ id: 'msg-1', deleted_at: NOW });

        await service.deleteMessage(viewer, 'msg-1');
        expect(db.chatConversation.update.mock.calls[0][0].data.last_message_preview).toBe(
            '[message deleted]',
        );
    });
});

describe('ChatService.addParticipants / removeParticipant', () => {
    it('refuses to add anyone to a direct message', async () => {
        const { service } = makeService({
            membership: {
                conversationId: 'conv-1',
                kind: 'dm',
                title: null,
                archivedAt: null,
                participantId: 'part-1',
                role: 'admin',
                lastReadAt: null,
                mutedUntil: null,
            },
        });
        await expect(
            service.addParticipants(viewer, 'conv-1', { participantIds: ['user-3'] }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires group admin to add people', async () => {
        const { service } = makeService({
            membership: {
                conversationId: 'conv-1',
                kind: 'group',
                title: 'Floor staff',
                archivedAt: null,
                participantId: 'part-1',
                role: 'member',
                lastReadAt: null,
                mutedUntil: null,
            },
        });
        await expect(
            service.addParticipants(viewer, 'conv-1', { participantIds: ['user-3'] }),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('re-admits someone who left by clearing left_at, not inserting a row', async () => {
        const { service, db } = makeService();
        db.chatParticipant.findMany.mockResolvedValue([
            { id: 'p-2', user_id: 'user-2', left_at: new Date() },
        ]);

        await service.addParticipants(viewer, 'conv-1', { participantIds: ['user-2'] });
        // A second row would violate the [conversation_id, user_id] unique index.
        expect(db.chatParticipant.create).not.toHaveBeenCalled();
        expect(db.chatParticipant.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'p-2' } }),
        );
    });

    it('treats adding an existing member as a no-op', async () => {
        const { service, db } = makeService();
        db.chatParticipant.findMany.mockResolvedValue([
            { id: 'p-2', user_id: 'user-2', left_at: null },
        ]);

        await service.addParticipants(viewer, 'conv-1', { participantIds: ['user-2'] });
        expect(db.chatParticipant.create).not.toHaveBeenCalled();
        expect(db.chatParticipant.update).not.toHaveBeenCalled();
    });

    it('lets a plain member remove themselves', async () => {
        const { service, db } = makeService({
            membership: {
                conversationId: 'conv-1',
                kind: 'group',
                title: 'Floor staff',
                archivedAt: null,
                participantId: 'part-1',
                role: 'member',
                lastReadAt: null,
                mutedUntil: null,
            },
        });
        db.chatParticipant.findFirst.mockResolvedValue({ id: 'part-1' });

        // Removing yourself is "leave group" and needs no admin rights.
        await expect(service.removeParticipant(viewer, 'conv-1', 'user-1')).resolves.toEqual({
            left: true,
        });
    });

    it('requires admin to remove somebody else', async () => {
        const { service } = makeService({
            membership: {
                conversationId: 'conv-1',
                kind: 'group',
                title: 'Floor staff',
                archivedAt: null,
                participantId: 'part-1',
                role: 'member',
                lastReadAt: null,
                mutedUntil: null,
            },
        });
        await expect(
            service.removeParticipant(viewer, 'conv-1', 'user-2'),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('promotes the longest-standing member when the last admin leaves', async () => {
        const { service, db } = makeService();
        db.chatParticipant.findFirst.mockResolvedValue({ id: 'part-1' });
        db.chatParticipant.findMany.mockResolvedValue([
            { id: 'p-2', role: 'member' },
            { id: 'p-3', role: 'member' },
        ]);

        await service.removeParticipant(viewer, 'conv-1', 'user-1');
        // Otherwise the group can never be renamed, archived, or added to again.
        expect(db.chatParticipant.update).toHaveBeenCalledWith({
            where: { id: 'p-2' },
            data: { role: 'admin' },
        });
    });
});

describe('ChatService.listMessages', () => {
    it('rejects an unknown pagination cursor', async () => {
        const { service, db } = makeService();
        db.chatMessage.findFirst.mockResolvedValue(null);

        await expect(
            service.listMessages(viewer, 'conv-1', { before: 'nope' }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns messages oldest-first and reports the next cursor', async () => {
        const { service, db } = makeService();
        const row = (id: string, at: Date) => ({
            id,
            conversation_id: 'conv-1',
            sender_id: 'user-1',
            body: id,
            kind: 'text',
            edited_at: null,
            deleted_at: null,
            created_at: at,
            sender: { id: 'user-1', name: 'Karim', email: 'k@x.com', avatar_url: null },
            attachments: [],
        });
        // Queried newest-first, one over the limit to detect a further page.
        db.chatMessage.findMany.mockResolvedValue([
            row('c', new Date('2026-08-22T10:02:00Z')),
            row('b', new Date('2026-08-22T10:01:00Z')),
            row('a', new Date('2026-08-22T10:00:00Z')),
        ]);

        const result = await service.listMessages(viewer, 'conv-1', { limit: 2 });
        expect(result.messages.map((m) => m.id)).toEqual(['b', 'c']);
        expect(result.hasMore).toBe(true);
        expect(result.nextCursor).toBe('b');
    });

    it('hides the body and attachments of a deleted message', async () => {
        const { service, db } = makeService();
        db.chatMessage.findMany.mockResolvedValue([
            {
                id: 'msg-1',
                conversation_id: 'conv-1',
                sender_id: 'user-1',
                body: 'leftover',
                kind: 'text',
                edited_at: null,
                deleted_at: NOW,
                created_at: NOW,
                sender: { id: 'user-1', name: 'Karim', email: 'k@x.com', avatar_url: null },
                attachments: [
                    { id: 'a-1', file_url: 'u', file_name: 'f', mime_type: 'image/png', file_size: 1 },
                ],
            },
        ]);

        const result = await service.listMessages(viewer, 'conv-1', {});
        expect(result.messages[0]).toMatchObject({ deleted: true, body: '', attachments: [] });
    });
});

describe('ChatService.unreadCount', () => {
    it('is zero when the caller is in no conversations', async () => {
        const { service, db } = makeService();
        db.chatParticipant.findMany.mockResolvedValue([]);

        expect(await service.unreadCount(viewer)).toEqual({ count: 0 });
        // The badge is polled by every logged-in user; no memberships, no query.
        expect(db.chatMessage.groupBy).not.toHaveBeenCalled();
    });

    it('keeps counting a conversation whose mute has expired', async () => {
        const { service, db } = makeService();
        db.chatParticipant.findMany.mockResolvedValue([
            { last_read_at: null, conversation: { id: 'conv-1' } },
        ]);
        db.chatMessage.groupBy.mockResolvedValue([
            { conversation_id: 'conv-1', _count: { _all: 4 } },
        ]);

        expect(await service.unreadCount(viewer)).toEqual({ count: 4 });
        // Matching on `muted_until: null` alone would drop the conversation from
        // the badge forever, because an expired mute leaves a past date behind.
        const where = db.chatParticipant.findMany.mock.calls[0][0].where;
        expect(where.muted_until).toBeUndefined();
        expect(where.OR).toEqual([
            { muted_until: null },
            { muted_until: { lt: expect.any(Date) } },
        ]);
    });

    it('sums unread across conversations, excluding the caller’s own messages', async () => {
        const { service, db } = makeService();
        db.chatParticipant.findMany.mockResolvedValue([
            { last_read_at: null, conversation: { id: 'conv-1' } },
            { last_read_at: NOW, conversation: { id: 'conv-2' } },
        ]);
        db.chatMessage.groupBy.mockResolvedValue([
            { conversation_id: 'conv-1', _count: { _all: 2 } },
            { conversation_id: 'conv-2', _count: { _all: 3 } },
        ]);

        expect(await service.unreadCount(viewer)).toEqual({ count: 5 });
        expect(db.chatMessage.groupBy.mock.calls[0][0].where.sender_id).toEqual({ not: 'user-1' });
    });
});

describe('ChatService.updateConversation', () => {
    it('refuses to rename a direct message', async () => {
        const { service } = makeService({
            membership: {
                conversationId: 'conv-1',
                kind: 'dm',
                title: null,
                archivedAt: null,
                participantId: 'part-1',
                role: 'admin',
                lastReadAt: null,
                mutedUntil: null,
            },
        });
        await expect(
            service.updateConversation(viewer, 'conv-1', { title: 'Nope' }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets a plain member mute without admin rights', async () => {
        // Muting is personal; renaming and archiving change the thread for all.
        const { service, db } = makeService({
            membership: {
                conversationId: 'conv-1',
                kind: 'group',
                title: 'Floor staff',
                archivedAt: null,
                participantId: 'part-1',
                role: 'member',
                lastReadAt: null,
                mutedUntil: null,
            },
        });

        await service.updateConversation(viewer, 'conv-1', { muteMinutes: 60 });
        expect(db.chatParticipant.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'part-1' } }),
        );
    });

    it('clears the mute when given zero', async () => {
        const { service, db } = makeService();
        await service.updateConversation(viewer, 'conv-1', { muteMinutes: 0 });
        expect(db.chatParticipant.update.mock.calls[0][0].data.muted_until).toBeNull();
    });
});

describe('ChatService.getConversation read cursors', () => {
    const READ_AT = new Date('2026-08-22T09:30:00.000Z');

    function withParticipants() {
        const { service, db } = makeService();
        db.chatConversation.findUnique.mockResolvedValue({
            id: 'conv-1',
            kind: 'dm',
            title: null,
            archived_at: null,
            created_at: NOW,
            created_by: 'user-1',
            last_message_at: NOW,
            last_message_preview: 'hello',
            participants: [
                {
                    user_id: 'user-1',
                    role: 'member',
                    last_read_at: NOW,
                    user: { id: 'user-1', name: 'Karim', email: 'k@x.com', avatar_url: null },
                },
                {
                    user_id: 'user-2',
                    role: 'member',
                    last_read_at: READ_AT,
                    user: { id: 'user-2', name: 'Ayesha', email: 'a@x.com', avatar_url: null },
                },
            ],
        });
        return { service, db };
    }

    it("returns the other participant's read cursor so the sender can show a receipt", async () => {
        const { service } = withParticipants();
        const conversation = await service.getConversation(viewer, 'conv-1');
        const peer = conversation.participants.find((p) => p.id === 'user-2');
        expect(peer?.lastReadAt).toEqual(READ_AT);
    });

    it('withholds the viewer’s own cursor', async () => {
        // Your own cursor says nothing about who has seen your messages, and
        // handing it back invites the client to mark its own sends as seen.
        const { service } = withParticipants();
        const conversation = await service.getConversation(viewer, 'conv-1');
        const me = conversation.participants.find((p) => p.id === 'user-1');
        expect(me?.lastReadAt).toBeNull();
    });
});
