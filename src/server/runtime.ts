import { startServer } from './index.js';

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer(Number(process.env.PORT) || 3000).catch((err: any) => {
    console.error('[FATAL RUNTIME STARTUP ERROR]', err);
    process.exit(1);
  });
}

