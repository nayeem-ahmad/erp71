import { Module } from '@nestjs/common';
import { SalesQuotationsController } from './sales-quotations.controller';
import { PublicQuotationsController } from './public-quotations.controller';
import { SalesQuotationsService } from './sales-quotations.service';
import { DatabaseModule } from '../database/database.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { ShortLinksModule } from '../short-links/short-links.module';

@Module({
    imports: [DatabaseModule, SalesOrdersModule, ShortLinksModule],
    controllers: [SalesQuotationsController, PublicQuotationsController],
    providers: [SalesQuotationsService],
})
export class SalesQuotationsModule {}
