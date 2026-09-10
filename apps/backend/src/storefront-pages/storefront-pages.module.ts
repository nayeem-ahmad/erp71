import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { StorefrontPagesService } from './storefront-pages.service';
import { StorefrontPagesController } from './storefront-pages.controller';
import { PublicStorefrontPagesController } from './public-storefront-pages.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [StorefrontPagesController, PublicStorefrontPagesController],
    providers: [StorefrontPagesService],
    exports: [StorefrontPagesService],
})
export class StorefrontPagesModule {}
