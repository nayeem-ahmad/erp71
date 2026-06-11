import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
    imports: [InvitationsModule],
    controllers: [TeamController],
    providers: [TeamService],
})
export class TeamModule {}
