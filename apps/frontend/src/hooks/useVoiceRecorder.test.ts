import { act, renderHook } from '@testing-library/react';
import { formatRecordingTime, useVoiceRecorder, voiceNoteExtension } from './useVoiceRecorder';

class FakeRecorder {
    static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
    static last: FakeRecorder | null = null;
    state: 'inactive' | 'recording' = 'inactive';
    mimeType: string;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(_stream: unknown, opts?: { mimeType?: string }) {
        this.mimeType = opts?.mimeType ?? '';
        FakeRecorder.last = this;
    }
    start() {
        this.state = 'recording';
    }
    stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['abc'], { type: this.mimeType }) });
        this.onstop?.();
    }
}

describe('useVoiceRecorder', () => {
    const track = { stop: jest.fn() };
    const getUserMedia = jest.fn();

    beforeEach(() => {
        (global as any).MediaRecorder = FakeRecorder;
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia },
        });
        getUserMedia.mockResolvedValue({ getTracks: () => [track] });
        track.stop.mockClear();
    });

    afterEach(() => {
        delete (global as any).MediaRecorder;
    });

    it('hands back the recording as a file and releases the microphone', async () => {
        const onRecorded = jest.fn();
        const { result } = renderHook(() => useVoiceRecorder({ onRecorded }));
        expect(result.current.supported).toBe(true);

        await act(async () => {
            await result.current.start();
        });
        expect(result.current.recording).toBe(true);

        act(() => result.current.stop());
        expect(result.current.recording).toBe(false);
        expect(track.stop).toHaveBeenCalled();
        const file: File = onRecorded.mock.calls[0][0];
        expect(file.type).toBe('audio/webm');
        expect(file.name).toMatch(/^voice-note-.*\.webm$/);
    });

    it('reports a refused microphone', async () => {
        getUserMedia.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
        const { result } = renderHook(() => useVoiceRecorder({ onRecorded: jest.fn() }));
        await act(async () => {
            await result.current.start();
        });
        expect(result.current.error).toBe('denied');
        expect(result.current.recording).toBe(false);
    });

    it('throws a recording away when the composer closes mid-take', async () => {
        const onRecorded = jest.fn();
        const { result, unmount } = renderHook(() => useVoiceRecorder({ onRecorded }));
        await act(async () => {
            await result.current.start();
        });
        unmount();
        expect(onRecorded).not.toHaveBeenCalled();
        expect(track.stop).toHaveBeenCalled();
    });
});

describe('voice note helpers', () => {
    it('formats elapsed time', () => {
        expect(formatRecordingTime(0)).toBe('0:00');
        expect(formatRecordingTime(83_400)).toBe('1:23');
    });

    it('names the file after what was recorded', () => {
        expect(voiceNoteExtension('audio/mp4')).toBe('m4a');
        expect(voiceNoteExtension('audio/ogg;codecs=opus')).toBe('ogg');
        expect(voiceNoteExtension('audio/webm')).toBe('webm');
    });
});
