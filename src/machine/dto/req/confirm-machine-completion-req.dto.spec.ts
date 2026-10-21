import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmMachineCompletionReqDto } from './confirm-machine-completion-req.dto';

describe('ConfirmMachineCompletionReqDto', () => {
  it.each([undefined, null, '', 'not-a-uuid', true])(
    'rejects invalid usageUuid: %s',
    async (usageUuid) => {
      expect(
        await validate(
          plainToInstance(ConfirmMachineCompletionReqDto, { usageUuid }),
        ),
      ).not.toHaveLength(0);
    },
  );
  it('accepts a session UUID', async () => {
    expect(
      await validate(
        plainToInstance(ConfirmMachineCompletionReqDto, {
          usageUuid: '00000000-0000-4000-8000-000000000001',
        }),
      ),
    ).toHaveLength(0);
  });
});
