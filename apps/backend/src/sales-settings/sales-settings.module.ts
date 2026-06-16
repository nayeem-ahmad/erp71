import { Module } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { SalesSettingsService } from './sales-settings.service';
import { SalesSettingsController } from './sales-settings.controller';

@Module({
  controllers: [SalesSettingsController],
  providers: [SalesSettingsService, PrismaService],
  exports: [SalesSettingsService],
})
export class SalesSettingsModule {}
