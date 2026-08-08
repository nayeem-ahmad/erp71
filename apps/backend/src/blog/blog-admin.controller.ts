import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { BlogService } from './blog.service';
import { BlogAiDraftDto, PublishBlogPostDto, UpsertBlogCategoryDto, UpsertBlogPostDto } from './blog.dto';

/**
 * Authoring surface for the platform blog. Platform staff only — these posts
 * belong to no tenant, so there is no tenant permission that could gate them.
 *
 * Publishing is its own endpoint rather than a `status` field on PATCH: the
 * rules live in one place that way, and the audit trail records
 * `blog.posts.publish.create` instead of an indistinguishable update.
 */
@Controller('admin/blog')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class BlogAdminController {
    constructor(private readonly service: BlogService) {}

    @Get('posts')
    list(
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.adminList({
            status,
            search,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @Get('categories')
    listCategories() {
        return this.service.listCategories();
    }

    @Post('categories')
    createCategory(@Body() dto: UpsertBlogCategoryDto) {
        return this.service.createCategory(dto);
    }

    @Patch('categories/:id')
    updateCategory(@Param('id') id: string, @Body() dto: UpsertBlogCategoryDto) {
        return this.service.updateCategory(id, dto);
    }

    @Delete('categories/:id')
    removeCategory(@Param('id') id: string) {
        return this.service.removeCategory(id);
    }

    @Post('ai-draft')
    draftWithAi(@Body() dto: BlogAiDraftDto) {
        return this.service.draftWithAi(dto);
    }

    @Get('posts/:id')
    get(@Param('id') id: string) {
        return this.service.adminGet(id);
    }

    @Post('posts')
    create(@Req() req: any, @Body() dto: UpsertBlogPostDto) {
        return this.service.create(dto, { userId: req.user?.userId, name: req.user?.name });
    }

    @Patch('posts/:id')
    update(@Param('id') id: string, @Body() dto: UpsertBlogPostDto) {
        return this.service.update(id, dto);
    }

    @Post('posts/:id/publish')
    publish(@Param('id') id: string, @Body() dto: PublishBlogPostDto) {
        return this.service.publish(id, dto?.published_at);
    }

    @Post('posts/:id/unpublish')
    unpublish(@Param('id') id: string) {
        return this.service.unpublish(id);
    }

    @Post('posts/:id/archive')
    archive(@Param('id') id: string) {
        return this.service.archive(id);
    }

    @Post('posts/:id/cover')
    @UseInterceptors(FileInterceptor('cover'))
    setCover(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
        return this.service.setCover(id, file);
    }

    @Delete('posts/:id/cover')
    removeCover(@Param('id') id: string) {
        return this.service.removeCover(id);
    }

    @Delete('posts/:id')
    remove(@Param('id') id: string) {
        return this.service.remove(id);
    }
}
