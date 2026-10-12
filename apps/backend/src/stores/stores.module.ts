import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';
import { OnlineBranchService } from './online-branch.service';

@Module({
    imports: [DatabaseModule],
    controllers: [StoresController],
    providers: [StoresService, OnlineBranchService],
    exports: [OnlineBranchService],
})
export class StoresModule {}
