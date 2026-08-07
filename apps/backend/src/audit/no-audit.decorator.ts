import { SetMetadata } from '@nestjs/common';

export const NO_AUDIT_KEY = 'erp71:no-audit';

/**
 * Opt a controller or handler out of the global `AuditInterceptor`.
 *
 * Use it where a service already writes a richer, hand-authored audit row —
 * otherwise the same action lands in the table twice, once with a domain
 * payload and once with the generic route-derived one.
 */
export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true);
