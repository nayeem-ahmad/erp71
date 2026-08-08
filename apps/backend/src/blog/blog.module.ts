import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AssetsModule } from '../assets/assets.module';
import { BlogService } from './blog.service';
import { BlogController } from './blog.controller';
import { BlogAdminController } from './blog-admin.controller';

@Module({
    imports: [DatabaseModule, AssetsModule],
    controllers: [BlogController, BlogAdminController],
    providers: [BlogService],
    exports: [BlogService],
})
export class BlogModule {}
