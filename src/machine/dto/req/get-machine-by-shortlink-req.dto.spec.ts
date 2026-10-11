import { validate } from 'class-validator';
import { GetMachineByShortlinkReqDto } from './get-machine-by-shortlink-req.dto';

describe('GetMachineByShortlinkReqDto', () => {
  it.each(['abc123', 'AbC_123-xy'])(
    'accepts a short code: %s',
    async (shortCode) => {
      const dto = Object.assign(new GetMachineByShortlinkReqDto(), {
        shortCode,
      });
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  it.each([undefined, '', 'abc/123', 'https://s.gistory.me/abc123', 'abc?x=1'])(
    'rejects an invalid short code: %s',
    async (shortCode) => {
      const dto = Object.assign(new GetMachineByShortlinkReqDto(), {
        shortCode,
      });
      expect(await validate(dto)).not.toHaveLength(0);
    },
  );
});
