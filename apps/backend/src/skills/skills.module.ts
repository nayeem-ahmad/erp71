import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

@Module({
    imports: [DatabaseModule],
    controllers: [SkillsController],
    providers: [SkillsService],
    exports: [SkillsService],
})
export class SkillsModule {}
