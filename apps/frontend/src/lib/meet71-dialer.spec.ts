/**
 * @jest-environment jsdom
 */
import { ApiError, api } from '@/lib/api';
import { meet71DeepLink, meet71PublicOrigin, placeMeet71Call } from '@/lib/meet71-dialer';

jest.mock('@/lib/api', () => {
    const actual = jest.requireActual('@/lib/api');
    return {
        ...actual,
        api: {
            startMeet71Call: jest.fn(),
        },
    };
});

describe('meet71-dialer', () => {
    const open = jest.fn();
    const previousOrigin = process.env.NEXT_PUBLIC_MEET71_ORIGIN;

    beforeEach(() => {
        jest.resetAllMocks();
        process.env.NEXT_PUBLIC_MEET71_ORIGIN = 'https://meet.erp71.com';
        window.open = open;
    });

    afterEach(() => {
        if (previousOrigin === undefined) delete process.env.NEXT_PUBLIC_MEET71_ORIGIN;
        else process.env.NEXT_PUBLIC_MEET71_ORIGIN = previousOrigin;
    });

    it('builds a deep link with to + mode', () => {
        expect(meet71PublicOrigin()).toBe('https://meet.erp71.com');
        expect(meet71DeepLink('Peer@ERP71.com', 'video')).toBe(
            'https://meet.erp71.com/call?to=peer%40erp71.com&mode=video',
        );
    });

    it('opens callerUrl from POST /meet71/calls when available', async () => {
        (api.startMeet71Call as jest.Mock).mockResolvedValue({
            callerUrl: 'https://meet.erp71.com/call/c1',
        });

        await placeMeet71Call('peer@erp71.com', 'voice');

        expect(api.startMeet71Call).toHaveBeenCalledWith({ to: 'peer@erp71.com', mode: 'voice' });
        expect(open).toHaveBeenCalledWith(
            'https://meet.erp71.com/call/c1',
            '_blank',
            'noopener,noreferrer',
        );
    });

    it('falls back to the deep link on 409 and 503', async () => {
        (api.startMeet71Call as jest.Mock).mockRejectedValueOnce(
            new ApiError('Busy', 409, 'MEET71_BUSY'),
        );
        await placeMeet71Call('peer@erp71.com', 'video');
        expect(open).toHaveBeenCalledWith(
            'https://meet.erp71.com/call?to=peer%40erp71.com&mode=video',
            '_blank',
            'noopener,noreferrer',
        );

        open.mockClear();
        (api.startMeet71Call as jest.Mock).mockRejectedValueOnce(
            new ApiError('Down', 503, 'MEET71_UNAVAILABLE'),
        );
        await placeMeet71Call('peer@erp71.com', 'voice');
        expect(open).toHaveBeenCalledWith(
            'https://meet.erp71.com/call?to=peer%40erp71.com&mode=voice',
            '_blank',
            'noopener,noreferrer',
        );
    });

    it('rethrows other API errors', async () => {
        (api.startMeet71Call as jest.Mock).mockRejectedValue(
            new ApiError('Nope', 403, 'MEET71_NOT_ALLOWED'),
        );
        await expect(placeMeet71Call('peer@erp71.com')).rejects.toMatchObject({
            status: 403,
            code: 'MEET71_NOT_ALLOWED',
        });
        expect(open).not.toHaveBeenCalled();
    });
});
