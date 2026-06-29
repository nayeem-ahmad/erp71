import { Injectable } from '@nestjs/common';
import type { CheckResult } from '@erp71/shared-types';
import { CircuitBreakerRegistry } from '../resilience/circuit-breaker.registry';

/**
 * Reports outbound-call circuit breakers. Any breaker that is open or
 * half-open means a downstream provider is struggling — non-critical, so it
 * degrades rather than downs the system. `disabled` until a breaker exists
 * (i.e. no outbound call has happened yet this process).
 */
@Injectable()
export class CircuitBreakerCheck {
    constructor(private readonly registry: CircuitBreakerRegistry) {}

    async run(): Promise<CheckResult> {
        const base: Pick<CheckResult, 'name' | 'label' | 'critical'> = {
            name: 'circuit_breakers',
            label: 'Circuit breakers',
            critical: false,
        };

        const breakers = this.registry.snapshots();
        if (breakers.length === 0) {
            return { ...base, state: 'disabled', message: 'No outbound calls yet' };
        }

        const tripped = breakers.filter((b) => b.state !== 'closed');
        const details = { breakers, tripped: tripped.map((b) => b.name) };

        if (tripped.length > 0) {
            return {
                ...base,
                state: 'degraded',
                message: `${tripped.length} circuit(s) not closed: ${tripped.map((b) => b.name).join(', ')}`,
                details,
            };
        }

        return { ...base, state: 'ok', details };
    }
}
