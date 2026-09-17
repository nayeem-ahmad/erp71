/**
 * Server-Sent Events framing, kept apart from any transport.
 *
 * `EventSource` would normally do this, but it cannot send an `Authorization`
 * header — and this app's session is a bearer token, not a cookie — so streams
 * are read with `fetch` and the frames are split here instead. A reader gets
 * arbitrary chunks, so the last frame in a chunk is usually incomplete: the
 * parser hands back the unconsumed tail for the next call to prepend.
 */

export interface SseFrame {
    /** The `event:` name, or `message` when the server did not send one. */
    event: string;
    /** The joined `data:` lines, parsed as JSON when they are JSON. */
    data: unknown;
}

/**
 * Split whatever has arrived so far into complete frames.
 *
 * Frames end at a blank line. Comment lines (`:` first) are the heartbeat and
 * carry no payload, so a frame made of nothing but comments is dropped rather
 * than reported as an event with no data. Unparseable JSON comes back as the
 * raw string: the callers here use events as a nudge to refetch, so a payload
 * they cannot read is still worth acting on.
 */
export function readSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
    // \r\n is legal in the protocol and some proxies rewrite line endings.
    const normalized = buffer.replace(/\r\n/g, '\n');
    const chunks = normalized.split('\n\n');
    // The trailing piece is only complete if the buffer ended on a blank line,
    // in which case split leaves an empty string here.
    const rest = chunks.pop() ?? '';
    const frames: SseFrame[] = [];

    for (const chunk of chunks) {
        let event = 'message';
        const dataLines: string[] = [];

        for (const line of chunk.split('\n')) {
            if (!line || line.startsWith(':')) continue;
            const separator = line.indexOf(':');
            const field = separator === -1 ? line : line.slice(0, separator);
            // One optional space after the colon belongs to the protocol, not the value.
            const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
            if (field === 'event') event = value;
            else if (field === 'data') dataLines.push(value);
        }

        if (dataLines.length === 0) continue;
        const raw = dataLines.join('\n');
        let data: unknown = raw;
        try {
            data = JSON.parse(raw);
        } catch {
            // Left as the raw string — see above.
        }
        frames.push({ event, data });
    }

    return { frames, rest };
}
