import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterLiveActivityReqDto } from './register-live-activity-req.dto';

jest.mock(
  'generated/prisma/client',
  () =>
    jest.requireActual<typeof import('../../../../generated/prisma/enums')>(
      '../../../../generated/prisma/enums',
    ),
  { virtual: true },
);

describe('RegisterLiveActivityReqDto', () => {
  const errorsFor = (input: unknown) =>
    validate(plainToInstance(RegisterLiveActivityReqDto, input));

  it('accepts a hex token with a valid environment', async () => {
    await expect(
      errorsFor({ pushToken: 'AB12cd34', environment: 'SANDBOX' }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    ['non-hex token', { pushToken: '../x', environment: 'PRODUCTION' }],
    ['empty token', { pushToken: '', environment: 'PRODUCTION' }],
    ['oversized token', { pushToken: 'a'.repeat(513), environment: 'SANDBOX' }],
    ['missing environment', { pushToken: 'ab12' }],
    ['unknown environment', { pushToken: 'ab12', environment: 'DEV' }],
  ])('rejects %s', async (_name, input) => {
    expect((await errorsFor(input)).length).toBeGreaterThan(0);
  });
});
