import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetMachineUsageHistoryReqDto } from './get-machine-usage-history-req.dto';

describe('GetMachineUsageHistoryReqDto', () => {
  it('defaults to the first 20 records', async () => {
    const dto = plainToInstance(GetMachineUsageHistoryReqDto, {});
    expect(dto).toMatchObject({ limit: 20, offset: 0 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts numeric query strings', async () => {
    const dto = plainToInstance(GetMachineUsageHistoryReqDto, {
      limit: '100',
      offset: '20',
    });
    expect(dto).toMatchObject({ limit: 100, offset: 20 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '1.5' },
    { limit: 'invalid' },
    { offset: '-1' },
    { offset: '1.5' },
    { offset: 'invalid' },
  ])('rejects invalid pagination: %j', async (query) => {
    expect(
      await validate(plainToInstance(GetMachineUsageHistoryReqDto, query)),
    ).not.toHaveLength(0);
  });
});
