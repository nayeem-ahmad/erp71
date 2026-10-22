import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { SalesSettingsService } from './sales-settings.service';
import { SalesSettingsController } from './sales-settings.controller';

@Module({
  imports: [DatabaseModule, PreferencesModule],
  controllers: [SalesSettingsController],
  providers: [SalesSettingsService],
  exports: [SalesSettingsService],
})
export class SalesSettingsModule {}
