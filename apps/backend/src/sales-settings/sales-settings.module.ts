import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SalesSettingsService } from './sales-settings.service';
import { SalesSettingsController } from './sales-settings.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [SalesSettingsController],
  providers: [SalesSettingsService],
  exports: [SalesSettingsService],
})
export class SalesSettingsModule {}
