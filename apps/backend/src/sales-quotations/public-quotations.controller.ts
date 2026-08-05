import { Controller, Get, Param } from '@nestjs/common';
import { SalesQuotationsService } from './sales-quotations.service';

/**
 * No guard and no TenantInterceptor by design — the unguessable token is the
 * authorization, and the service resolves the tenant from it rather than from
 * anything the caller supplies.
 */
@Controller('public/quotations')
export class PublicQuotationsController {
    constructor(private readonly service: SalesQuotationsService) {}

    @Get(':token')
    findByToken(@Param('token') token: string) {
        return this.service.findByShareToken(token);
    }
}
