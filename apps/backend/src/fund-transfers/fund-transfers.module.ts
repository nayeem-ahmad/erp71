import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { FundTransfersController } from './fund-transfers.controller';
import { FundTransfersService } from './fund-transfers.service';

@Module({
    imports: [DatabaseModule],
    controllers: [FundTransfersController],
    providers: [FundTransfersService],
})
export class FundTransfersModule {}