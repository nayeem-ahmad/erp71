import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ShortLinksService } from './short-links.service';
import { CreateShortLinkDto } from './short-links.dto';

/**
 * Platform staff sit outside any tenant, so these links are stored with a null
 * `tenant_id` — and the list is scoped to exactly those. Platform-owned, not
 * "all tenants": a staffer has no business reading the shortener rows behind
 * another company's customer quotations.
 *
 * `revoke` stays deliberately unscoped by tenant. Killing an abusive or
 * mistaken link anywhere on the platform is a support action these accounts are
 * meant to have, and it destroys access rather than granting it.
 */
@Controller('admin/short-links')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class ShortLinksAdminController {
    constructor(private readonly service: ShortLinksService) {}

    @Get()
    list() {
        return this.service.list(null);
    }

    @Post()
    create(@Req() req: any, @Body() dto: CreateShortLinkDto) {
        return this.service.createManual(null, req.user?.userId, dto);
    }

    @Delete(':id')
    async revoke(@Param('id') id: string) {
        await this.service.revoke(id, null);
        return { success: true };
    }
}
