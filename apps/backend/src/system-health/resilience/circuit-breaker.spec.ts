import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

const ok = async () => 'ok';
const fail = async () => {
    throw new Error('boom');
};

describe('CircuitBreaker', () => {
    it('passes calls through and stays closed on success', async () => {
        const cb = new CircuitBreaker('t', { failureThreshold: 3 });
        await expect(cb.execute(ok)).resolves.toBe('ok');
        expect(cb.getState()).toBe('closed');
    });

    it('opens after the failure threshold and then fails fast', async () => {
        const cb = new CircuitBreaker('t', { failureThreshold: 3, resetTimeoutMs: 10_000 });

        for (let i = 0; i < 3; i++) {
            await expect(cb.execute(fail)).rejects.toThrow('boom');
        }
        expect(cb.getState()).toBe('open');

        // Open: rejects without invoking fn.
        const spy = jest.fn(fail);
        await expect(cb.execute(spy)).rejects.toBeInstanceOf(CircuitOpenError);
        expect(spy).not.toHaveBeenCalled();
    });

    it('resets failure count on a successful call', async () => {
        const cb = new CircuitBreaker('t', { failureThreshold: 3 });
        await expect(cb.execute(fail)).rejects.toThrow();
        await expect(cb.execute(fail)).rejects.toThrow();
        await expect(cb.execute(ok)).resolves.toBe('ok'); // resets
        await expect(cb.execute(fail)).rejects.toThrow();
        expect(cb.getState()).toBe('closed'); // only 1 failure since reset
    });

    /**
     * Cooldown wide enough that the assertions below are not racing it.
     *
     * These two cases used a 5ms cooldown and slept 8ms. That leaves ~5ms for
     * a rejected promise to settle and the next line to run — fine on an idle
     * machine, and not fine on a loaded CI runner, where the breaker had
     * already moved to half_open by the time `getState()` was called and the
     * suite failed on a change nowhere near it. 200ms of headroom costs half a
     * second across both cases and removes the race entirely.
     */
    const COOLDOWN_MS = 200;
    const PAST_COOLDOWN_MS = 260;

    it('moves to half-open after the cooldown and closes on a successful trial', async () => {
        const cb = new CircuitBreaker('t', { failureThreshold: 1, resetTimeoutMs: COOLDOWN_MS });
        await expect(cb.execute(fail)).rejects.toThrow();
        expect(cb.getState()).toBe('open');

        await new Promise((r) => setTimeout(r, PAST_COOLDOWN_MS));
        expect(cb.getState()).toBe('half_open');

        await expect(cb.execute(ok)).resolves.toBe('ok');
        expect(cb.getState()).toBe('closed');
    });

    it('re-opens immediately if the half-open trial fails', async () => {
        const cb = new CircuitBreaker('t', { failureThreshold: 1, resetTimeoutMs: COOLDOWN_MS });
        await expect(cb.execute(fail)).rejects.toThrow();
        await new Promise((r) => setTimeout(r, PAST_COOLDOWN_MS));
        expect(cb.getState()).toBe('half_open');

        await expect(cb.execute(fail)).rejects.toThrow('boom');
        expect(cb.getState()).toBe('open');
    });

    it('times out a slow call and counts it as a failure', async () => {
        const cb = new CircuitBreaker('t', { failureThreshold: 1, timeoutMs: 10 });
        const slow = () => new Promise((resolve) => setTimeout(() => resolve('late'), 50));
        await expect(cb.execute(slow)).rejects.toThrow(/timed out/);
        expect(cb.getState()).toBe('open');
    });

    it('snapshots its state', async () => {
        const cb = new CircuitBreaker('payment', { failureThreshold: 1 });
        await expect(cb.execute(fail)).rejects.toThrow();
        const snap = cb.snapshot();
        expect(snap.name).toBe('payment');
        expect(snap.state).toBe('open');
        expect(snap.failures).toBe(1);
        expect(snap.opened_at).not.toBeNull();
    });
});
