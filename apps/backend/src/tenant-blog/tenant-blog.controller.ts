import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantBlogService } from './tenant-blog.service';
import {
    PublishTenantBlogPostDto,
    TenantBlogStatusDto,
    UpdateTenantBlogSettingsDto,
    UpsertTenantBlogCategoryDto,
    UpsertTenantBlogPostDto,
} from './tenant-blog.dto';

/**
 * A shop's own blog, managed from inside the app.
 *
 * Writing and publishing are separate permissions. Drafting a post is ordinary
 * content work; putting it on the shop's public page is the shop speaking in
 * its own name, and an owner may reasonably want the second held by fewer
 * people than the first.
 */
@Controller('blog/manage')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class TenantBlogController {
    constructor(private readonly service: TenantBlogService) {}

    @Get('settings')
    @RequireStorePermission(StorePermission.VIEW_BLOG)
    getSettings(@Tenant() tenant: TenantContext) {
        return this.service.getSettings(tenant.tenantId);
    }

    @Patch('settings')
    @RequireStorePermission(StorePermission.MANAGE_BLOG)
    updateSettings(@Tenant() tenant: TenantContext, @Body() dto: UpdateTenantBlogSettingsDto) {
        return this.service.updateSettings(tenant.tenantId, tenant.userId, dto);
    }

    @Get('categories')
    @RequireStorePermission(StorePermission.VIEW_BLOG)
    listCategories(@Tenant() tenant: TenantContext) {
        return this.service.listCategories(tenant.tenantId);
    }

    @Post('categories')
    @RequireStorePermission(StorePermission.MANAGE_BLOG)
    createCategory(@Tenant() tenant: TenantContext, @Body() dto: UpsertTenantBlogCategoryDto) {
        return this.service.createCategory(tenant.tenantId, dto);
    }

    @Patch('categories/:id')
    @RequireStorePermission(StorePermission.MANAGE_BLOG)
    updateCategory(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpsertTenantBlogCategoryDto) {
        return this.service.updateCategory(tenant.tenantId, id, dto);
    }

    @Delete('categories/:id')
    @RequireStorePermission(StorePermission.MANAGE_BLOG)
    removeCategory(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.removeCategory(tenant.tenantId, id);
    }

    @Get('posts')
    @RequireStorePermission(StorePermission.VIEW_BLOG)
    list(
        @Tenant() tenant: TenantContext,
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.list(tenant.tenantId, {
            status,
            search,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @Get('posts/:id')
    @RequireStorePermission(StorePermission.VIEW_BLOG)
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.get(tenant.tenantId, id);
    }

    @Post('posts')
    @RequireStorePermission(StorePermission.MANAGE_BLOG)
    create(@Tenant() tenant: TenantContext, @Body() dto: UpsertTenantBlogPostDto) {
        return this.service.create(tenant.tenantId, { userId: tenant.userId }, dto);
    }

    @Patch('posts/:id')
    @RequireStorePermission(StorePermission.MANAGE_BLOG)
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpsertTenantBlogPostDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Post('posts/:id/publish')
    @RequireStorePermission(StorePermission.PUBLISH_BLOG)
    publish(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: PublishTenantBlogPostDto) {
        return this.service.publish(tenant.tenantId, id, dto?.published_at);
    }

    /**
     * Unpublishing and archiving are PUBLISH_BLOG too: taking a live post down
     * changes what the shop is saying in public just as much as putting it up.
     */
    @Patch('posts/:id/status')
    @RequireStorePermission(StorePermission.PUBLISH_BLOG)
    setStatus(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: TenantBlogStatusDto) {
        return this.service.setStatus(tenant.tenantId, id, dto.status);
    }

    @Post('posts/:id/cover')
    @RequireStorePermission(StorePermission.MANAGE_BLOG)
    @UseInterceptors(FileInterceptor('cover'))
    setCover(@Tenant() tenant: TenantContext, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
        return this.service.setCover(tenant.tenantId, id, file);
    }

    @Delete('posts/:id/cover')
    @RequireStorePermission(StorePermission.MANAGE_BLOG)
    removeCover(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.removeCover(tenant.tenantId, id);
    }

    @Delete('posts/:id')
    @RequireStorePermission(StorePermission.MANAGE_BLOG)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
