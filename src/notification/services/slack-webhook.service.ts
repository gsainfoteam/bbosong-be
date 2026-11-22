import { Injectable, Logger } from '@nestjs/common';
import { BbosongConfigService } from '../../config/bbosong-config.service';
import { formatError } from '../../common/utils/format-error.util';

const SLACK_TIMEOUT_MS = 5_000;

/**
 * Optional admin alert channel. When SLACK_WEBHOOK_URL is unset, sending is a no-op.
 * Never throws, so a Slack outage cannot block other notification channels.
 */
@Injectable()
export class SlackWebhookService {
  private readonly logger = new Logger(SlackWebhookService.name);

  constructor(private readonly configService: BbosongConfigService) {}

  async send(text: string): Promise<void> {
    const url = this.configService.slackWebhookUrl;
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.error(`Slack webhook responded with ${res.status}`);
      }
    } catch (error: unknown) {
      this.logger.error(`Failed to send Slack webhook: ${formatError(error)}`);
    }
  }
}
