import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Meet71ClientService } from './meet71-client.service';

describe('Meet71ClientService', () => {
    const previousUrl = process.env.MEET71_INTERNAL_URL;
    const previousSecret = process.env.MEET71_ERP71_SECRET;
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.resetAllMocks();
        process.env.MEET71_INTERNAL_URL = 'http://meet71-app-1:3000';
        process.env.MEET71_ERP71_SECRET = 'shared-secret';
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        if (previousUrl === undefined) delete process.env.MEET71_INTERNAL_URL;
        else process.env.MEET71_INTERNAL_URL = previousUrl;
        if (previousSecret === undefined) delete process.env.MEET71_ERP71_SECRET;
        else process.env.MEET71_ERP71_SECRET = previousSecret;
    });

    it('isConfigured is false without INTERNAL_URL', () => {
        delete process.env.MEET71_INTERNAL_URL;
        expect(new Meet71ClientService().isConfigured()).toBe(false);
    });

    it('getPresence throws 503 when INTERNAL_URL is missing', async () => {
        delete process.env.MEET71_INTERNAL_URL;
        await expect(new Meet71ClientService().getPresence()).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('getPresence sends service key and actor email', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ online: ['A@Erp71.com', 'b@erp71.com'] }),
        });

        const result = await new Meet71ClientService().getPresence('Caller@ERP71.com');

        expect(result.online).toEqual(['a@erp71.com', 'b@erp71.com']);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://meet71-app-1:3000/api/internal/presence',
            expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({
                    'X-Meet71-Service-Key': 'shared-secret',
                    'X-Meet71-Actor-Email': 'caller@erp71.com',
                }),
            }),
        );
    });

    it('startCall returns callerUrl and roomUrl', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            text: async () =>
                JSON.stringify({
                    call: { id: 'c1' },
                    callerUrl: 'https://meet.erp71.com/call/c1?role=caller',
                    roomUrl: 'https://meet.erp71.com/room/c1',
                }),
        });

        const result = await new Meet71ClientService().startCall({
            to: 'Peer@ERP71.com',
            mode: 'voice',
            fromName: 'Caller',
            fromEmail: 'caller@erp71.com',
        });

        expect(result).toEqual({
            call: { id: 'c1' },
            callerUrl: 'https://meet.erp71.com/call/c1?role=caller',
            roomUrl: 'https://meet.erp71.com/room/c1',
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://meet71-app-1:3000/api/internal/calls',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    to: 'peer@erp71.com',
                    mode: 'voice',
                    fromName: 'Caller',
                }),
            }),
        );
    });

    it('startCall maps Meet71 409 to ConflictException', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 409,
            text: async () => JSON.stringify({ code: 'MEET71_BUSY', message: 'Busy' }),
        });

        await expect(
            new Meet71ClientService().startCall({ to: 'peer@erp71.com', mode: 'video' }),
        ).rejects.toBeInstanceOf(ConflictException);
    });
});
