/**
 * Minimal circuit breaker — no external dependency. Wraps an outbound call so
 * that repeated failures "open" the circuit and subsequent calls fail fast
 * (instead of piling up against a dead provider and exhausting resources).
 * After a cooldown the circuit goes "half-open" and allows a single trial.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
    /** Consecutive failures before the circuit opens. Default 5. */
    failureThreshold?: number;
    /** How long the circuit stays open before a half-open trial. Default 30s. */
    resetTimeoutMs?: number;
    /** Optional per-call timeout; 0 disables it. Default 0. */
    timeoutMs?: number;
}

export interface CircuitSnapshot {
    name: string;
    state: CircuitState;
    failures: number;
    opened_at: string | null;
    last_failure_at: string | null;
}

/** Thrown when a call is rejected because the circuit is open. */
export class CircuitOpenError extends Error {
    constructor(name: string) {
        super(`Circuit "${name}" is open`);
        this.name = 'CircuitOpenError';
    }
}

export class CircuitBreaker {
    private state: CircuitState = 'closed';
    private failures = 0;
    private openedAt: number | null = null;
    private lastFailureAt: number | null = null;

    private readonly failureThreshold: number;
    private readonly resetTimeoutMs: number;
    private readonly timeoutMs: number;

    constructor(
        readonly name: string,
        options: CircuitBreakerOptions = {},
    ) {
        this.failureThreshold = options.failureThreshold ?? 5;
        this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
        this.timeoutMs = options.timeoutMs ?? 0;
    }

    /** Current state, transitioning open → half_open once the cooldown elapses. */
    getState(): CircuitState {
        if (
            this.state === 'open' &&
            this.openedAt !== null &&
            Date.now() - this.openedAt >= this.resetTimeoutMs
        ) {
            this.state = 'half_open';
        }
        return this.state;
    }

    /** Runs `fn` under the breaker. Throws CircuitOpenError when open. */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.getState() === 'open') {
            throw new CircuitOpenError(this.name);
        }

        try {
            const result = this.timeoutMs > 0 ? await this.withTimeout(fn()) : await fn();
            this.onSuccess();
            return result;
        } catch (err) {
            this.onFailure();
            throw err;
        }
    }

    private withTimeout<T>(promise: Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`Circuit "${this.name}" call timed out after ${this.timeoutMs}ms`)),
                this.timeoutMs,
            );
            promise.then(
                (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
            );
        });
    }

    private onSuccess(): void {
        this.failures = 0;
        this.state = 'closed';
        this.openedAt = null;
    }

    private onFailure(): void {
        this.failures += 1;
        this.lastFailureAt = Date.now();
        // A failed half-open trial re-opens immediately; otherwise open on threshold.
        if (this.state === 'half_open' || this.failures >= this.failureThreshold) {
            this.state = 'open';
            this.openedAt = Date.now();
        }
    }

    snapshot(): CircuitSnapshot {
        return {
            name: this.name,
            state: this.getState(),
            failures: this.failures,
            opened_at: this.openedAt ? new Date(this.openedAt).toISOString() : null,
            last_failure_at: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
        };
    }
}
