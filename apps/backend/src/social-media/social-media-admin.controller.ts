import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { SocialMediaService } from './social-media.service';
import { PushSocialPostDto, UpsertSocialPostDto } from './social-media.dto';

/**
 * The platform's own social posts. Platform staff only — like the blog, these
 * belong to no tenant, so there is no tenant permission that could gate them.
 */
@Controller('admin/social-media')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class SocialMediaAdminController {
    constructor(private readonly service: SocialMediaService) {}

    @Get('posts')
    list(
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.list({
            status,
            search,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    /**
     * Declared before `posts/:id` would be reachable, and on its own path
     * segment, so a channel lookup can never be read as a post id.
     */
    @Get('buffer/status')
    bufferStatus() {
        return this.service.bufferStatus();
    }

    @Get('buffer/channels')
    bufferChannels() {
        return this.service.listBufferChannels();
    }

    @Post('buffer/test')
    testBuffer() {
        return this.service.testBuffer();
    }

    @Get('posts/:id')
    get(@Param('id') id: string) {
        return this.service.get(id);
    }

    @Post('posts')
    create(@Req() req: any, @Body() dto: UpsertSocialPostDto) {
        return this.service.create(dto, { userId: req.user?.userId, name: req.user?.name });
    }

    @Patch('posts/:id')
    update(@Param('id') id: string, @Body() dto: UpsertSocialPostDto) {
        return this.service.update(id, dto);
    }

    @Post('posts/:id/duplicate')
    duplicate(@Req() req: any, @Param('id') id: string) {
        return this.service.duplicate(id, { userId: req.user?.userId, name: req.user?.name });
    }

    /**
     * Its own endpoint rather than a status field on PATCH, for the reason the
     * blog's publish route gives: the rules live in one place, and this call
     * reaches a third party — it must not be reachable by accident from an edit.
     */
    @Post('posts/:id/push')
    push(@Req() req: any, @Param('id') id: string, @Body() dto: PushSocialPostDto) {
        return this.service.pushToBuffer(id, dto ?? {}, {
            userId: req.user?.userId,
            name: req.user?.name,
        });
    }

    @Delete('posts/:id')
    remove(@Param('id') id: string) {
        return this.service.remove(id);
    }
}
