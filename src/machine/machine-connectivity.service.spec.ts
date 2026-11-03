import { Logger } from '@nestjs/common';
import type { Machine } from 'generated/prisma/client';
import { MatterConnectionService } from '@lib/matter-client/matter-connection.service';
import { MachineConnectivityService } from './machine-connectivity.service';
import { GetMachineResDto } from './dto/res/get-machine-res.dto';

jest.mock('@matter-server/ws-client', () => ({}), { virtual: true });
jest.mock('@lib/database/repositories/machine.repository', () => ({}));
jest.mock('../notification/notification.service', () => ({}));
jest.mock('generated/prisma/client', () =>
  jest.requireActual<typeof import('../../generated/prisma/enums')>(
    '../../generated/prisma/enums',
  ),
);

describe('Machine connectivity', () => {
  const machine = {
    uuid: 'machine-1',
    macAddress: 'mac-1',
    location: 'A',
    gender: 'MALE',
    type: 'WASHER',
    index: 1,
    isCommissioned: true,
    deletedAt: null,
  } as Machine;
  const repository = { getMachines: jest.fn(), getMachine: jest.fn() };
  const matter = { getAvailableMacAddressesBySite: jest.fn() };
  const notification = { notifyMachineOffline: jest.fn() };
  let service: MachineConnectivityService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    repository.getMachines.mockResolvedValue([machine]);
    repository.getMachine.mockResolvedValue(machine);
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set(['mac-1'])]]),
    );
    notification.notifyMachineOffline.mockResolvedValue(undefined);
    service = new MachineConnectivityService(
      repository as never,
      matter as never,
      notification as never,
    );
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps an idle device online without any power changes and exposes its last confirmation', async () => {
    await service.onModuleInit();
    const initial = service.get(machine).lastSeenAt;
    await jest.advanceTimersByTimeAsync(120_000);
    expect(service.get(machine)).toEqual({
      isOnline: true,
      lastSeenAt: new Date(),
    });
    expect(service.get(machine).lastSeenAt!.getTime()).toBeGreaterThan(
      initial!.getTime(),
    );
    expect(new GetMachineResDto(machine, service.get(machine))).toMatchObject(
      service.get(machine),
    );
    expect(notification.notifyMachineOffline).not.toHaveBeenCalled();
  });

  it('debounces unavailability for 60 seconds, sends one alert and preserves lastSeenAt', async () => {
    await service.onModuleInit();
    const lastSeenAt = service.get(machine).lastSeenAt;
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    await jest.advanceTimersByTimeAsync(60_000);
    expect(service.get(machine).isOnline).toBe(true);
    expect(notification.notifyMachineOffline).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(service.get(machine)).toEqual({ isOnline: false, lastSeenAt });
    expect(notification.notifyMachineOffline).toHaveBeenCalledWith(machine);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(notification.notifyMachineOffline).toHaveBeenCalledTimes(1);
  });

  it('resets the grace period on recovery and alerts again only after a new outage', async () => {
    await service.onModuleInit();
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    await jest.advanceTimersByTimeAsync(60_000);
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set(['mac-1'])]]),
    );
    await jest.advanceTimersByTimeAsync(30_000);
    expect(notification.notifyMachineOffline).not.toHaveBeenCalled();
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    await jest.advanceTimersByTimeAsync(90_000);
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set(['mac-1'])]]),
    );
    await jest.advanceTimersByTimeAsync(30_000);
    expect(service.get(machine).isOnline).toBe(true);
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    await jest.advanceTimersByTimeAsync(90_000);
    expect(notification.notifyMachineOffline).toHaveBeenCalledTimes(2);
  });

  it('detects commissioned devices missing on startup, even when never seen', async () => {
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    await service.onModuleInit();
    expect(service.get(machine)).toEqual({ isOnline: null, lastSeenAt: null });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(service.get(machine)).toEqual({ isOnline: false, lastSeenAt: null });
    expect(notification.notifyMachineOffline).toHaveBeenCalledTimes(1);
  });

  it('requires the device to belong to the configured site', async () => {
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([
        ['A', new Set<string>()],
        ['B', new Set(['mac-1'])],
      ]),
    );
    await service.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(service.get(machine).isOnline).toBe(false);
  });

  it.each([true, false])(
    'preserves the last confirmed state during failed site queries (online=%s)',
    async (online) => {
      matter.getAvailableMacAddressesBySite.mockResolvedValue(
        new Map([['A', new Set(online ? ['mac-1'] : [])]]),
      );
      await service.onModuleInit();
      await jest.advanceTimersByTimeAsync(60_000);
      const confirmed = service.get(machine);
      const alertCount = notification.notifyMachineOffline.mock.calls.length;
      expect(confirmed.isOnline).toBe(online);

      matter.getAvailableMacAddressesBySite.mockResolvedValue(new Map());
      await jest.advanceTimersByTimeAsync(180_000);
      expect(service.get(machine)).toEqual(confirmed);
      expect(notification.notifyMachineOffline).toHaveBeenCalledTimes(
        alertCount,
      );
    },
  );

  it('keeps an unobserved device unknown until its site is queried successfully', async () => {
    matter.getAvailableMacAddressesBySite.mockResolvedValue(new Map());
    await service.onModuleInit();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(service.get(machine)).toEqual({ isOnline: null, lastSeenAt: null });
    expect(notification.notifyMachineOffline).not.toHaveBeenCalled();

    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    await jest.advanceTimersByTimeAsync(60_000);
    expect(service.get(machine).isOnline).toBeNull();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(service.get(machine).isOnline).toBe(false);
    expect(notification.notifyMachineOffline).toHaveBeenCalledTimes(1);
  });

  it('continues checking successful sites while another site query fails', async () => {
    const other = { ...machine, uuid: 'machine-2', location: 'B' as const };
    repository.getMachines.mockResolvedValue([machine, other]);
    await service.onModuleInit();
    const confirmed = service.get(machine);

    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['B', new Set<string>()]]),
    );
    await jest.advanceTimersByTimeAsync(90_000);
    expect(service.get(machine)).toEqual(confirmed);
    expect(service.get(other).isOnline).toBe(false);
    expect(notification.notifyMachineOffline).toHaveBeenCalledTimes(1);
    expect(notification.notifyMachineOffline).toHaveBeenCalledWith(other);
  });

  it('does not reset an existing grace period when a site query fails', async () => {
    await service.onModuleInit();
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    await jest.advanceTimersByTimeAsync(30_000);
    matter.getAvailableMacAddressesBySite.mockResolvedValue(new Map());
    await jest.advanceTimersByTimeAsync(60_000);
    expect(service.get(machine).isOnline).toBe(true);
    expect(notification.notifyMachineOffline).not.toHaveBeenCalled();

    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    await jest.advanceTimersByTimeAsync(30_000);
    expect(service.get(machine).isOnline).toBe(false);
    expect(notification.notifyMachineOffline).toHaveBeenCalledTimes(1);
  });

  it('excludes uncommissioned and soft-deleted devices', async () => {
    const uncommissioned = { ...machine, isCommissioned: false };
    const deleted = { ...machine, uuid: 'deleted', deletedAt: new Date() };
    repository.getMachines.mockResolvedValue([uncommissioned, deleted]);
    await service.onModuleInit();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(service.get(uncommissioned)).toEqual({
      isOnline: null,
      lastSeenAt: null,
    });
    expect(service.get(deleted)).toEqual({ isOnline: null, lastSeenAt: null });
    expect(notification.notifyMachineOffline).not.toHaveBeenCalled();
    expect(repository.getMachine).not.toHaveBeenCalled();
  });

  it.each([null, true])(
    'excludes MAC-less ThinQ dryers from Matter connectivity (isCommissioned=%s)',
    async (isCommissioned) => {
      const dryer = {
        ...machine,
        type: 'DRYER' as const,
        thinqDeviceId: 'device',
        macAddress: null,
        matterPayload: null,
        isCommissioned,
      };
      repository.getMachines.mockResolvedValue([dryer]);
      await service.onModuleInit();
      await jest.advanceTimersByTimeAsync(120_000);
      expect(service.get(dryer)).toEqual({ isOnline: null, lastSeenAt: null });
      expect(notification.notifyMachineOffline).not.toHaveBeenCalled();
      expect(repository.getMachine).not.toHaveBeenCalled();
    },
  );

  it('drops a deleted device from monitoring during an outage', async () => {
    await service.onModuleInit();
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    await jest.advanceTimersByTimeAsync(60_000);
    repository.getMachines.mockResolvedValue([]);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(service.get(machine)).toEqual({ isOnline: null, lastSeenAt: null });
    expect(notification.notifyMachineOffline).not.toHaveBeenCalled();
  });

  it('does not alert if deletion happens between the list query and transition', async () => {
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    await service.onModuleInit();
    repository.getMachine.mockResolvedValue(null);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(notification.notifyMachineOffline).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps detecting recovery after a notification failure', async () => {
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    notification.notifyMachineOffline.mockRejectedValue(
      new Error('push unavailable'),
    );
    await service.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(service.get(machine).isOnline).toBe(false);
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set(['mac-1'])]]),
    );
    await jest.advanceTimersByTimeAsync(30_000);
    expect(service.get(machine).isOnline).toBe(true);
  });

  it('retries a transition after the active-machine recheck fails', async () => {
    await service.onModuleInit();
    matter.getAvailableMacAddressesBySite.mockResolvedValue(
      new Map([['A', new Set<string>()]]),
    );
    repository.getMachine.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await jest.advanceTimersByTimeAsync(90_000);
    expect(notification.notifyMachineOffline).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(service.get(machine).isOnline).toBe(false);
    expect(notification.notifyMachineOffline).toHaveBeenCalledTimes(1);
  });

  it('does not overlap slow checks and stops the timer on shutdown', async () => {
    await service.onModuleInit();
    let resolve!: (value: Map<string, Set<string>>) => void;
    matter.getAvailableMacAddressesBySite.mockReturnValue(
      new Promise<Map<string, Set<string>>>((done) => {
        resolve = done;
      }),
    );
    await jest.advanceTimersByTimeAsync(90_000);
    expect(matter.getAvailableMacAddressesBySite).toHaveBeenCalledTimes(2);
    const shutdown = service.onModuleDestroy();
    resolve(new Map());
    await shutdown;
    await jest.advanceTimersByTimeAsync(120_000);
    expect(matter.getAvailableMacAddressesBySite).toHaveBeenCalledTimes(2);
  });
});

describe('Matter server reachability snapshot', () => {
  it('filters native availability, refreshes instead of trusting the cache and isolates site failures', async () => {
    const service = new MatterConnectionService({ sites: [] });
    const getNodes = jest.fn().mockResolvedValue([
      { available: true, serialNumber: 'reachable' },
      { available: false, serialNumber: 'offline' },
      { available: true, serialNumber: '' },
    ]);
    const disconnected = jest.fn();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    Object.assign(service, {
      clients: new Map([
        [
          'A',
          {
            connection: { connected: true },
            getNodes,
            nodes: { cached: { available: true, serialNumber: 'offline' } },
          },
        ],
        ['B', { connection: { connected: false }, getNodes: disconnected }],
        [
          'C',
          {
            connection: { connected: true },
            getNodes: jest.fn().mockRejectedValue(new Error('timeout')),
          },
        ],
      ]),
    });
    try {
      expect(await service.getAvailableMacAddressesBySite()).toEqual(
        new Map([['A', new Set(['reachable'])]]),
      );
      expect(getNodes).toHaveBeenCalledWith(false, 10_000);
      expect(disconnected).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
