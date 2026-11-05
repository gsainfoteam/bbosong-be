import { GetMachineResDto } from './get-machine-res.dto';

export { MachineUsageInfoDto } from './get-machine-res.dto';

/** Detail response; same shape as list (`GetMachineResDto`), including `currentUsage`. */
export class GetMachineDetailResDto extends GetMachineResDto {}
