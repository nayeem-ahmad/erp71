import { Injectable } from '@nestjs/common';
import { CircuitBreaker, CircuitBreakerOptions, CircuitSnapshot } from './circuit-breaker';

/**
 * Holds named circuit breakers so outbound-call sites share one instance per
 * provider and the system-health check can read their states.
 */
@Injectable()
export class CircuitBreakerRegistry {
    private readonly breakers = new Map<string, CircuitBreaker>();

    /** Returns the named breaker, creating it (with `options`) on first use. */
    get(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
        let breaker = this.breakers.get(name);
        if (!breaker) {
            breaker = new CircuitBreaker(name, options);
            this.breakers.set(name, breaker);
        }
        return breaker;
    }

    snapshots(): CircuitSnapshot[] {
        return [...this.breakers.values()].map((b) => b.snapshot());
    }
}
