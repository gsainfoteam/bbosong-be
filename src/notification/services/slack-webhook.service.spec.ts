import { SlackWebhookService } from './slack-webhook.service';

describe('SlackWebhookService', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });
  const make = (url?: string) =>
    new SlackWebhookService({ slackWebhookUrl: url } as never);

  it('does nothing when SLACK_WEBHOOK_URL is unset', async () => {
    await make().send('hi');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the text as JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await make('https://hooks.slack.com/x').send('hi');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/x',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'hi' }),
      }),
    );
  });

  it('swallows network and HTTP errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(make('https://h/x').send('hi')).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(make('https://h/x').send('hi')).resolves.toBeUndefined();
  });
});
