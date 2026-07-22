import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { SummaryModule } from './summary/summary.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, SummaryModule],
})
export class AppModule {}
