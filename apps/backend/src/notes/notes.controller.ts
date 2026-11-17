import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreateNoteDto, ListNotesQueryDto, UpdateNoteDto, UploadNoteImageDto } from './notes.dto';
import { NotesService } from './notes.service';

/**
 * Tools → Notes. Every route is self-scoped: the service filters on the
 * signed-in member as well as the workspace, so no store permission applies —
 * a note is nobody's business but its author's.
 */
@Controller('notes')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class NotesController {
    constructor(private readonly notes: NotesService) {}

    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: ListNotesQueryDto) {
        return this.notes.findAll(tenant, query);
    }

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateNoteDto) {
        return this.notes.create(tenant, dto);
    }

    /** Before `:id` so "images" is never read as a note id. Throttled: the body is a picture. */
    @Post('images')
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    uploadImage(@Tenant() tenant: TenantContext, @Body() dto: UploadNoteImageDto) {
        return this.notes.uploadImage(tenant, dto);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.notes.findOne(tenant, id);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateNoteDto) {
        return this.notes.update(tenant, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.notes.remove(tenant, id);
    }
}
