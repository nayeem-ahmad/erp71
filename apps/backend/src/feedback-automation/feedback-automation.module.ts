import { Module } from '@nestjs/common';
import { FeedbackAutomationController } from './feedback-automation.controller';
import { FeedbackAutomationService } from './feedback-automation.service';
import { FeedbackAgentRunnerService } from './feedback-agent-runner.service';
import { FeedbackGithubService } from './feedback-github.service';

@Module({
    controllers: [FeedbackAutomationController],
    providers: [FeedbackAutomationService, FeedbackAgentRunnerService, FeedbackGithubService],
    exports: [FeedbackAutomationService],
})
export class FeedbackAutomationModule {}
