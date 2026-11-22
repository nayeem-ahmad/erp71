import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PlatformRole } from '@erp71/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../../auth/platform-admin.guard';
import { AllowPlatformRoles } from '../../auth/platform-roles.decorator';
import { PageTimingSummaryQueryDto, RecordPageTimingsDto } from './page-timings.dto';
import { PageTimingsService } from './page-timings.service';

/**
 * Where the browser reports the page views it timed. Any signed-in user's
 * browser reports, so the numbers are what real users wait; nothing about the
 * user or workspace is stored with them.
 */
@Controller('page-timings')
@UseGuards(JwtAuthGuard)
export class PageTimingsController {
    constructor(private readonly pageTimings: PageTimingsService) {}

    // A tab flushes at most every 15 s, plus once when hidden; this leaves
    // room for several tabs without letting one script flood the table.
    @Post()
    @HttpCode(202)
    @Throttle({ default: { limit: 30, ttl: 60_000 } })
    record(@Body() dto: RecordPageTimingsDto) {
        return this.pageTimings.record(dto.samples);
    }
}

/** The page-performance dashboard on System Health; the same seats as the rest of that page. */
@Controller('admin/page-timings')
@AllowPlatformRoles(PlatformRole.SUPPORT_ENGINEER)
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminPageTimingsController {
    constructor(private readonly pageTimings: PageTimingsService) {}

    @Get()
    summary(@Query() query: PageTimingSummaryQueryDto) {
        return this.pageTimings.summary(query.days ?? 7, query.nav_type ?? null);
    }
}
