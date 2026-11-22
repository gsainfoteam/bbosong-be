import { ConfigService } from '@nestjs/config';
import { BbosongConfigService } from './bbosong-config.service';

const make = (env: Record<string, unknown> = {}) =>
  new BbosongConfigService(new ConfigService(env));

describe('BbosongConfigService', () => {
  it('splits and trims CORS origins, dropping empty entries', () => {
    expect(
      make({ CORS_ORIGINS: ' http://a.com, ,http://b.com,' }).corsOrigins,
    ).toEqual(['http://a.com', 'http://b.com']);
  });

  it('parses Matter sites, keeping colons in the websocket URL', () => {
    expect(make({ MATTER_SITES: 'a:ws://h:1,b:ws://i:2' }).matterSites).toEqual(
      [
        { id: 'a', wsUrl: 'ws://h:1' },
        { id: 'b', wsUrl: 'ws://i:2' },
      ],
    );
  });

  it('parses the Shlink short code length', () => {
    expect(make().shlinkShortCodeLength).toBeUndefined();
    expect(make({ SHLINK_SHORT_CODE_LENGTH: '6' }).shlinkShortCodeLength).toBe(
      6,
    );
  });

  it('trims the Slack webhook URL and treats blank as unset', () => {
    expect(make({ SLACK_WEBHOOK_URL: ' https://x ' }).slackWebhookUrl).toBe(
      'https://x',
    );
    expect(make({ SLACK_WEBHOOK_URL: '  ' }).slackWebhookUrl).toBeUndefined();
  });

  it('applies defaults for the FCM channel and machine register URL', () => {
    expect(make().fcmAndroidChannelId).toBe('default');
    expect(make({ FCM_ANDROID_CHANNEL_ID: 'c' }).fcmAndroidChannelId).toBe('c');
    expect(make().machineRegisterUrl).toBe(
      'https://bbosong.gistory.me/machine-register',
    );
  });
});
