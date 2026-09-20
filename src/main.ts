import { Logger } from '@nestjs/common';
import { makeApp } from './app';
import { initializeMetrics } from '@gsainfoteam/nest-observability';

async function bootstrap() {
  const app = await makeApp();

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

const bootstrapWithOTEL = async () => {
  const logger = new Logger('Bootstrap');
  try {
    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'bbosong-be';
    initializeMetrics(serviceName);
    await bootstrap();
  } catch (error) {
    logger.error('Failed to bootstrap application', error);
    process.exit(1);
  }
};

void bootstrapWithOTEL();
