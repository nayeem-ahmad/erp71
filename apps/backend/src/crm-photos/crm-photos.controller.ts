import { Body, Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CrmPhotosService } from './crm-photos.service';
import { UploadCrmPhotoDto } from './crm-photos.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

/**
 * Photo uploads for leads and contacts alike, which is why this is its own
 * module rather than a route on either: the photo is picked before the record
 * it belongs to exists, so it cannot hang off `/crm/leads/:id`.
 */
@Controller('crm/photos')
@UseGuards(JwtAuthGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmPhotosController {
    constructor(private readonly service: CrmPhotosService) {}

    /** Throttled like the card-attachment route: the body carries an image. */
    @Post()
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    upload(@Tenant() tenant: TenantContext, @Body() dto: UploadCrmPhotoDto) {
        return this.service.upload(tenant.tenantId, dto);
    }
}
