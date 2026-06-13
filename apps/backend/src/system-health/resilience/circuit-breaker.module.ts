import { Global, Module } from '@nestjs/common';
import { CircuitBreakerRegistry } from './circuit-breaker.registry';

/**
 * Global so outbound-call services (billing, SMS, email) can share the same
 * breaker registry without explicit imports.
 */
@Global()
@Module({
    providers: [CircuitBreakerRegistry],
    exports: [CircuitBreakerRegistry],
})
export class CircuitBreakerModule {}
