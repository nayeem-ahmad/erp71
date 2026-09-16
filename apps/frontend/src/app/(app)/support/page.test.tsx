import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupportPage from './page';
import { useToastStore } from '@/lib/toast';
import type { StreamHandlers } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getSupportThreads: jest.fn(),
        getSupportMessages: jest.fn(),
        sendSupportMessage: jest.fn(),
        createSupportThread: jest.fn(),
        openSupportStream: jest.fn(),
    },
}));

const thread = {
    id: 'thr-1',
    ticketNumber: 12,
    subject: 'POS will not print',
    status: 'open',
    category: 'support',
    page: '/pos',
    feedbackId: null,
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
    messageCount: 1,
    lastMessage: { body: 'The printer does nothing', senderRole: 'owner', createdAt: '2026-09-16T10:00:00.000Z' },
};

const messagesPayload = (status: string) => ({
    thread: {
        id: thread.id,
        ticketNumber: thread.ticketNumber,
        subject: thread.subject,
        status,
        category: 'support',
        page: '/pos',
        feedbackId: null,
    },
    messages: [
        {
            id: 'msg-1',
            senderRole: 'owner',
            senderName: 'Rahim',
            body: 'The printer does nothing',
            createdAt: '2026-09-16T10:00:00.000Z',
        },
    ],
});

/** The frame pump the page was handed, so a test can act like the backend. */
let stream: StreamHandlers;

describe('SupportPage', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = jest.fn();
        useToastStore.setState({ toasts: [] });
        const { api } = require('@/lib/api');
        api.getSupportThreads.mockResolvedValue([thread]);
        api.getSupportMessages.mockResolvedValue(messagesPayload('open'));
        api.openSupportStream.mockImplementation((handlers: StreamHandlers) => {
            stream = handlers;
            handlers.onConnected?.(true);
            handlers.onFrame({ event: 'ready', data: { at: '2026-09-16T10:00:00.000Z' } });
            return jest.fn();
        });
    });

    const openThread = async () => {
        render(<SupportPage />);
        fireEvent.click(await screen.findByText('POS will not print'));
        await waitFor(() => expect(screen.getByText('Ticket #12')).toBeInTheDocument());
    };

    it('shows each ticket by its number', async () => {
        render(<SupportPage />);
        expect(await screen.findByText('#12')).toBeInTheDocument();
    });

    it('names the open ticket in the conversation header', async () => {
        await openThread();
        expect(screen.getByText('Ticket #12')).toBeInTheDocument();
    });

    it('shows a thread resolved on the admin side without a refresh', async () => {
        const { api } = require('@/lib/api');
        await openThread();
        expect(screen.getByPlaceholderText('Type a message… (Enter to send)')).toBeInTheDocument();

        // The admin resolves it: the API now answers "resolved", and the stream
        // says so at the same moment.
        api.getSupportMessages.mockResolvedValue(messagesPayload('resolved'));
        api.getSupportThreads.mockResolvedValue([{ ...thread, status: 'resolved' }]);
        await act(async () => {
            stream.onFrame({
                event: 'status',
                data: {
                    kind: 'status',
                    threadId: 'thr-1',
                    ticketNumber: 12,
                    status: 'resolved',
                    actor: 'admin',
                    at: '2026-09-16T10:05:00.000Z',
                },
            });
        });

        await waitFor(() => expect(screen.getByText('Resolved')).toBeInTheDocument());
        expect(screen.queryByPlaceholderText('Type a message… (Enter to send)')).not.toBeInTheDocument();
        expect(useToastStore.getState().toasts.map((item) => item.message)).toEqual([
            'Support marked ticket #12 as resolved.',
        ]);
    });

    it('says which ticket was reopened', async () => {
        await openThread();

        await act(async () => {
            stream.onFrame({
                event: 'status',
                data: {
                    kind: 'status',
                    threadId: 'thr-1',
                    ticketNumber: 12,
                    status: 'open',
                    actor: 'admin',
                    at: '2026-09-16T10:05:00.000Z',
                },
            });
        });

        expect(useToastStore.getState().toasts.map((item) => item.message)).toEqual([
            'Ticket #12 was reopened.',
        ]);
    });

    it('re-reads the open thread when a reply arrives, and does not announce it', async () => {
        const { api } = require('@/lib/api');
        await openThread();
        const readsBefore = api.getSupportMessages.mock.calls.length;

        await act(async () => {
            stream.onFrame({
                event: 'message',
                data: {
                    kind: 'message',
                    threadId: 'thr-1',
                    ticketNumber: 12,
                    status: 'open',
                    actor: 'admin',
                    at: '2026-09-16T10:05:00.000Z',
                },
            });
        });

        // The reply lands in the conversation on screen, which is announcement
        // enough — a toast on top of it would be noise.
        expect(api.getSupportMessages.mock.calls.length).toBeGreaterThan(readsBefore);
        expect(useToastStore.getState().toasts).toEqual([]);
    });

    it('announces a reply on a ticket that is not the one being read', async () => {
        await openThread();

        await act(async () => {
            stream.onFrame({
                event: 'message',
                data: {
                    kind: 'message',
                    threadId: 'thr-2',
                    ticketNumber: 13,
                    status: 'open',
                    actor: 'admin',
                    at: '2026-09-16T10:05:00.000Z',
                },
            });
        });

        expect(useToastStore.getState().toasts.map((item) => item.message)).toEqual([
            'New reply on ticket #13.',
        ]);
    });

    it('ignores the server’s hello frame', async () => {
        render(<SupportPage />);
        await screen.findByText('#12');
        // `ready` carries no thread; treating it as an event would toast on
        // every reconnect.
        expect(useToastStore.getState().toasts).toEqual([]);
    });
});
