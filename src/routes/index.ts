import { Router } from 'express';
import type { RequestHandler } from 'express';

import apisRouter from './apis.js';
import billingRouter from './billing.js';
import healthRouter from './health.js';
import usageRouter from './usage.js';

export interface ApiRouterDeps {
  restRateLimit?: RequestHandler;
}

export function createApiRouter(deps: ApiRouterDeps = {}): Router {
  const router = Router();

  router.use('/health', healthRouter);
  router.use('/apis', apisRouter);
  router.use('/usage', usageRouter);

  if (deps.restRateLimit) {
    router.use('/billing', deps.restRateLimit, billingRouter);
  } else {
    router.use('/billing', billingRouter);
  }

  return router;
}

export default createApiRouter();
