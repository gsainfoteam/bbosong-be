import { DynamicModule, Module, Provider } from '@nestjs/common';
import {
  MATTER_CLIENT_OPTIONS,
  MatterClientModuleOptions,
} from './matter-client.options';
import { MatterConnectionService } from './matter-connection.service';

export type MatterClientModuleAsyncOptions = {
  imports?: DynamicModule['imports'];
  inject?: any[];
  useFactory: (
    ...args: any[]
  ) => Promise<MatterClientModuleOptions> | MatterClientModuleOptions;
};

@Module({})
export class MatterClientModule {
  static forRootAsync(options: MatterClientModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: MATTER_CLIENT_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject,
    };
    return {
      module: MatterClientModule,
      imports: options.imports ?? [],
      providers: [optionsProvider, MatterConnectionService],
      exports: [MatterConnectionService],
      global: false,
    };
  }
}
