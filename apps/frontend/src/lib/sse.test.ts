import { readSseFrames } from './sse';

describe('readSseFrames', () => {
    it('reads a complete frame', () => {
        const { frames, rest } = readSseFrames('event: status\ndata: {"threadId":"thr-1"}\n\n');
        expect(frames).toEqual([{ event: 'status', data: { threadId: 'thr-1' } }]);
        expect(rest).toBe('');
    });

    it('reads several frames out of one chunk', () => {
        const { frames } = readSseFrames(
            'event: status\ndata: {"n":1}\n\nevent: message\ndata: {"n":2}\n\n',
        );
        expect(frames.map((frame) => frame.event)).toEqual(['status', 'message']);
    });

    it('holds back a frame that has not finished arriving', () => {
        const first = readSseFrames('event: status\ndata: {"thr');
        expect(first.frames).toEqual([]);
        expect(first.rest).toBe('event: status\ndata: {"thr');

        // The next read prepends what was left over — which is the only way the
        // frame is ever seen whole.
        const second = readSseFrames(`${first.rest}eadId":"thr-1"}\n\n`);
        expect(second.frames).toEqual([{ event: 'status', data: { threadId: 'thr-1' } }]);
        expect(second.rest).toBe('');
    });

    it('drops heartbeat comments rather than reporting them as events', () => {
        const { frames, rest } = readSseFrames(': keep-alive\n\n');
        expect(frames).toEqual([]);
        expect(rest).toBe('');
    });

    it('defaults the event name to message when the server sends none', () => {
        const { frames } = readSseFrames('data: {"n":1}\n\n');
        expect(frames).toEqual([{ event: 'message', data: { n: 1 } }]);
    });

    it('joins multi-line data the way the protocol says to', () => {
        const { frames } = readSseFrames('data: line one\ndata: line two\n\n');
        expect(frames).toEqual([{ event: 'message', data: 'line one\nline two' }]);
    });

    it('keeps a payload it cannot parse, so the caller can still act on the nudge', () => {
        const { frames } = readSseFrames('event: status\ndata: not json\n\n');
        expect(frames).toEqual([{ event: 'status', data: 'not json' }]);
    });

    it('handles CRLF line endings, which a proxy may rewrite to', () => {
        const { frames } = readSseFrames('event: status\r\ndata: {"n":1}\r\n\r\n');
        expect(frames).toEqual([{ event: 'status', data: { n: 1 } }]);
    });

    it('tolerates a field with no space after the colon', () => {
        const { frames } = readSseFrames('event:status\ndata:{"n":1}\n\n');
        expect(frames).toEqual([{ event: 'status', data: { n: 1 } }]);
    });
});
