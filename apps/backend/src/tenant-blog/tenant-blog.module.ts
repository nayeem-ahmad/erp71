import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AssetsModule } from '../assets/assets.module';
import { TenantBlogService } from './tenant-blog.service';
import { TenantBlogController } from './tenant-blog.controller';
import { StorefrontBlogController } from './storefront-blog.controller';

@Module({
    imports: [DatabaseModule, AssetsModule],
    controllers: [TenantBlogController, StorefrontBlogController],
    providers: [TenantBlogService],
    exports: [TenantBlogService],
})
export class TenantBlogModule {}
