import { Controller, Get, Param } from '@nestjs/common';
import { MeetingsService } from './meetings.service';

/**
 * No guard and no TenantInterceptor — the unguessable token is the
 * authorization, the same shape as public quotations.
 */
@Controller('public/meetings')
export class PublicMeetingsController {
    constructor(private readonly meetings: MeetingsService) {}

    @Get(':token')
    findByToken(@Param('token') token: string) {
        return this.meetings.findByShareToken(token);
    }
}
