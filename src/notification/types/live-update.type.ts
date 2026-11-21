import { Machine, MachineType } from 'generated/prisma/client';
import { LiveActivityContentState } from './live-activity.type';

/** Value of the FCM data key `type` marking an Android Live Update message. */
export const LIVE_UPDATE_MESSAGE_TYPE = 'LIVE_UPDATE';

/** What the Android app needs to (re)build the Live Update of one session. */
export interface LiveUpdateSession {
  machineUuid: string;
  kind: MachineType;
  /** e.g. "A동 건조기 3번" */
  title: string;
  /** Session start; null when the caller does not know it (end messages). */
  startedAt: Date | null;
}

export function buildLiveUpdateSession(
  machine: Pick<Machine, 'uuid' | 'type' | 'location' | 'index'>,
  startedAt: Date | null,
): LiveUpdateSession {
  const typeName = machine.type === MachineType.WASHER ? '세탁기' : '건조기';
  return {
    machineUuid: machine.uuid,
    kind: machine.type,
    title: `${machine.location}동 ${typeName} ${machine.index}번`,
    startedAt,
  };
}

/**
 * FCM data values must be strings. Numbers are decimal strings (epoch
 * seconds / minutes) and null values are omitted, never sent as "".
 */
export function buildLiveUpdateData(
  session: LiveUpdateSession,
  contentState: LiveActivityContentState,
): Record<string, string> {
  const data: Record<string, string> = {
    type: LIVE_UPDATE_MESSAGE_TYPE,
    machineUuid: session.machineUuid,
    kind: session.kind,
    title: session.title,
    state: contentState.state,
    updatedAt: String(contentState.updatedAt),
  };
  if (session.startedAt) {
    data.startedAt = String(Math.floor(session.startedAt.getTime() / 1000));
  }
  if (contentState.endsAt !== null) data.endsAt = String(contentState.endsAt);
  if (contentState.remainingMinutes !== null) {
    data.remainingMinutes = String(contentState.remainingMinutes);
  }
  return data;
}
