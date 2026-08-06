import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AssetsModule } from '../assets/assets.module';
import { EmployeeRecordsController } from './employee-records.controller';
import { EmployeeRecordsService } from './employee-records.service';

@Module({
    imports: [DatabaseModule, AssetsModule],
    controllers: [EmployeeRecordsController],
    providers: [EmployeeRecordsService],
    exports: [EmployeeRecordsService],
})
export class EmployeeRecordsModule {}
