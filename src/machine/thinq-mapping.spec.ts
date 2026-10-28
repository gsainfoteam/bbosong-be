import { BadRequestException, ConflictException } from '@nestjs/common';
import { MachineRepository } from '../../libs/database/src/repositories/machine.repository';
import { MachineType, MachineStatus, Prisma } from 'generated/prisma/client';

jest.mock('@lib/database/database.service', () => ({}));
jest.mock('@lib/logger', () => ({ Loggable: () => () => undefined }));
jest.mock('@gsainfoteam/nest-observability', () => ({
  Trace: () => () => undefined,
}));

describe('ThinQ machine mapping repository', () => {
  const model = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const repository = new MachineRepository({ machine: model } as never);
  beforeEach(() => {
    jest.resetAllMocks();
    model.findUnique.mockResolvedValue({
      type: MachineType.DRYER,
      thinqDeviceId: 'previous',
      matterPayload: null,
    });
    model.update.mockResolvedValue({});
    model.updateMany.mockResolvedValue({ count: 1 });
  });

  it('rejects a washer mapping at creation', async () => {
    await expect(
      repository.createMachine({
        type: MachineType.WASHER,
        thinqDeviceId: 'device',
      } as never),
    ).rejects.toThrow(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('rejects a washer mapping at update', async () => {
    model.findUnique.mockResolvedValue({ type: MachineType.WASHER });
    await expect(
      repository.updateMachine(
        'washer',
        undefined,
        undefined,
        undefined,
        undefined,
        'device',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(model.update).not.toHaveBeenCalled();
  });

  it.each(['device', null])(
    'clears the last snapshot when the mapping changes to %s',
    async (deviceId) => {
      await repository.updateMachine(
        'dryer',
        undefined,
        undefined,
        undefined,
        undefined,
        deviceId,
      );
      const calls = model.update.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(calls[0][0].data).toMatchObject({
        thinqDeviceId: deviceId,
        thinqCurrentState: null,
        thinqRemainingMinutes: null,
        thinqUpdatedAt: null,
      });
    },
  );

  it('reports duplicate device mappings as a conflict', async () => {
    model.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );
    await expect(
      repository.updateMachine(
        'dryer',
        undefined,
        undefined,
        undefined,
        undefined,
        'device',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('only applies a snapshot to the same active dryer mapping', async () => {
    await expect(
      repository.updateThinqDryerState(
        'dryer',
        'device',
        'RUNNING',
        20,
        MachineStatus.DRY,
      ),
    ).resolves.toBe(1);
    expect(model.updateMany).toHaveBeenCalledWith({
      where: {
        uuid: 'dryer',
        deletedAt: null,
        type: MachineType.DRYER,
        thinqDeviceId: 'device',
      },
      data: {
        thinqCurrentState: 'RUNNING',
        thinqRemainingMinutes: 20,
        thinqUpdatedAt: expect.any(Date) as unknown,
        status: MachineStatus.DRY,
      },
    });
  });

  it('leaves status unchanged when the API gives no reliable lifecycle state', async () => {
    await repository.updateThinqDryerState(
      'dryer',
      'device',
      'ERROR',
      null,
      null,
    );
    const calls = model.updateMany.mock.calls as [{ data: object }][];
    const call = calls[0][0];
    expect(call.data).not.toHaveProperty('status');
  });
});
