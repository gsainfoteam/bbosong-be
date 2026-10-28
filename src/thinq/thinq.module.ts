import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ThinqService } from './thinq.service';

@Module({
  imports: [HttpModule.register({ timeout: 10_000, maxRedirects: 0 })],
  providers: [ThinqService],
  exports: [ThinqService],
})
export class ThinqModule {}
