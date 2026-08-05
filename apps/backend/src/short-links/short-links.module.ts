import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ShortLinksService } from './short-links.service';
import { ShortLinksController } from './short-links.controller';
import { ShortLinksAdminController } from './short-links-admin.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [ShortLinksController, ShortLinksAdminController],
    providers: [ShortLinksService],
    exports: [ShortLinksService],
})
export class ShortLinksModule {}
