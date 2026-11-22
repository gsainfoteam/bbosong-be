import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BbosongConfigService } from './bbosong-config.service';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [BbosongConfigService],
  exports: [BbosongConfigService],
})
export class BbosongConfigModule {}
