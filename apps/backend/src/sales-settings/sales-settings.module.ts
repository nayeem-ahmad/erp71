import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MemberPreferencesModule } from '../preferences/member-preferences.module';
import { SalesSettingsService } from './sales-settings.service';
import { SalesSettingsController } from './sales-settings.controller';

@Module({
  imports: [DatabaseModule, MemberPreferencesModule],
  controllers: [SalesSettingsController],
  providers: [SalesSettingsService],
  exports: [SalesSettingsService],
})
export class SalesSettingsModule {}
