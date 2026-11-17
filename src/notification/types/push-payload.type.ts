/**
 * Channel-agnostic push message. Web Push receives it as the JSON body; FCM
 * maps `title`/`body` to the notification and `url`/`icon`/`data` to the
 * string-only data map.
 */
export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  data?: Record<string, unknown>;
}
