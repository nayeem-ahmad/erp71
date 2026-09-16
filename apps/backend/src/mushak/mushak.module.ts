import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { MushakController } from './mushak.controller';
import { MushakService } from './mushak.service';

@Module({
    imports: [DatabaseModule],
    controllers: [MushakController],
    providers: [MushakService, StorePermissionGuard],
    exports: [MushakService],
})
export class MushakModule {}
