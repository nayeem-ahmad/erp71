import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { FeedbackAutomationService } from './feedback-automation.service';
import { ReviewPlanDto, SaveInstructionDto } from './feedback-automation.dto';

@Controller('admin/feedback')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class FeedbackAutomationController {
    constructor(private readonly service: FeedbackAutomationService) {}

    @Get(':id')
    async getOne(@Param('id') id: string) {
        return this.service.getFeedbackWithPlans(id);
    }

    @Post(':id/instruction')
    async saveInstruction(@Param('id') id: string, @Body() dto: SaveInstructionDto, @Request() req: any) {
        return this.service.saveInstruction(id, dto.instruction, req.user.userId);
    }

    @Post(':id/propose-plan')
    async proposePlan(@Param('id') id: string, @Request() req: any) {
        return this.service.requestPlan(id, req.user.userId);
    }

    @Post('plans/:planId/review')
    async reviewPlan(@Param('planId') planId: string, @Body() dto: ReviewPlanDto, @Request() req: any) {
        return this.service.reviewPlan(planId, dto.decision, dto.comment, dto.confirmMigration, req.user.userId);
    }

    @Post(':id/implement')
    async implementNow(@Param('id') id: string, @Request() req: any) {
        return this.service.implementNow(id, req.user.userId);
    }

    @Get(':id/pr-status')
    async prStatus(@Param('id') id: string) {
        return this.service.refreshPrStatus(id);
    }

    @Post(':id/rollback')
    async rollback(@Param('id') id: string, @Request() req: any) {
        return this.service.generateRollbackPr(id, req.user.userId);
    }
}
