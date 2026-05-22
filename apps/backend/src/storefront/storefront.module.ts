import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { StorefrontService } from './storefront.service';
import { StorefrontController } from './storefront.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [StorefrontController],
    providers: [StorefrontService],
})
export class StorefrontModule {}
