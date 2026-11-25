import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SetRemainingTimeReqDto } from './set-remaining-time-req.dto';

describe('SetRemainingTimeReqDto', () => {
  const errors = (remainingMinutes: unknown) =>
    validateSync(plainToInstance(SetRemainingTimeReqDto, { remainingMinutes }));

  it.each([1, 37, 180])('accepts %p', (value) => {
    expect(errors(value)).toHaveLength(0);
  });

  it.each([0, -5, 181, 12.5, '37', null])('rejects %p', (value) => {
    expect(errors(value)).not.toHaveLength(0);
  });
});
