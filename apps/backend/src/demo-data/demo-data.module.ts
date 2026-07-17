import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DemoDataController } from './demo-data.controller';
import { DemoDataService } from './demo-data.service';

@Module({
    imports: [DatabaseModule],
    controllers: [DemoDataController],
    providers: [DemoDataService],
})
export class DemoDataModule {}
