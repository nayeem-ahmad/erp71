import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DatabaseModule } from '../database/database.module';
import { BillScanService } from './bill-scan.service';
import { PriceCheckService } from './price-check.service';
import { ToolsController } from './tools.controller';

@Module({
    imports: [DatabaseModule, AiModule],
    controllers: [ToolsController],
    providers: [PriceCheckService, BillScanService],
})
export class ToolsModule {}
