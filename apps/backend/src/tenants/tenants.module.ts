import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [TenantsController],
    providers: [TenantsService],
})
export class TenantsModule {}
