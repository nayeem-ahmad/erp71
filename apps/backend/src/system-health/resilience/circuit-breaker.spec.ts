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

    it('moves to half-open after the cooldown and closes on a successful trial', async () => {
        const cb = new CircuitBreaker('t', { failureThreshold: 1, resetTimeoutMs: 5 });
        await expect(cb.execute(fail)).rejects.toThrow();
        expect(cb.getState()).toBe('open');

        await new Promise((r) => setTimeout(r, 8));
        expect(cb.getState()).toBe('half_open');

        await expect(cb.execute(ok)).resolves.toBe('ok');
        expect(cb.getState()).toBe('closed');
    });

    it('re-opens immediately if the half-open trial fails', async () => {
        const cb = new CircuitBreaker('t', { failureThreshold: 1, resetTimeoutMs: 5 });
        await expect(cb.execute(fail)).rejects.toThrow();
        await new Promise((r) => setTimeout(r, 8));
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
