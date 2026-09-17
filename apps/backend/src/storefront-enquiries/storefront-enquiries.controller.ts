import { Body, Controller, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StorefrontEnquiriesService } from './storefront-enquiries.service';
import { StorefrontEnquiryDto } from './storefront-enquiries.dto';

/**
 * The enquiry form on a shop's public storefront.
 *
 * Unguarded like the rest of `/storefront/:slug` — the whole point is that a
 * stranger can reach the shop — but this one *writes*, and to the tenant's CRM,
 * so it is throttled harder than the reads next door: three a minute per IP,
 * matching the platform's own `/contact` form.
 */
@Controller('storefront/:slug')
@Throttle({ default: { ttl: 60_000, limit: 3 } })
export class StorefrontEnquiriesController {
    constructor(private readonly service: StorefrontEnquiriesService) {}

    /**
     * Always `{ success: true }` on a well-formed enquiry, whether it created a
     * lead or appended to one. See the service: which of the two happened is
     * the shop's business, not the sender's.
     */
    @Post('enquiries')
    submit(@Param('slug') slug: string, @Body() dto: StorefrontEnquiryDto) {
        return this.service.submit(slug, dto);
    }
}
