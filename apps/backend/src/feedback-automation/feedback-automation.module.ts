import { Module } from '@nestjs/common';
import { FeedbackAutomationController } from './feedback-automation.controller';
import { FeedbackAutomationService } from './feedback-automation.service';
import { FeedbackAgentRunnerService } from './feedback-agent-runner.service';
import { FeedbackGithubService } from './feedback-github.service';
import { DeployController } from './deploy.controller';
import { DeployService } from './deploy.service';

@Module({
    controllers: [FeedbackAutomationController, DeployController],
    providers: [FeedbackAutomationService, FeedbackAgentRunnerService, FeedbackGithubService, DeployService],
    exports: [FeedbackAutomationService],
})
export class FeedbackAutomationModule {}
