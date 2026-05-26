import { Router } from 'express';
import healthRouter from './health.js';
import apisRouter from './apis.js';
import usageRouter from './usage.js';
import billingRouter from './billing.js';
import { createApiKeyRouter, type ApiKeyRoutesDeps } from './apiKeyRoutes.js';
import { defaultApiRepository } from '../repositories/apiRepository.js';
import { defaultDeveloperRepository } from '../repositories/developerRepository.js';

export function createRoutes(deps: Partial<ApiKeyRoutesDeps> = {}): Router {
  const router = Router();

  router.use('/health', healthRouter);
  router.use(
    createApiKeyRouter({
      apiRepository: deps.apiRepository ?? defaultApiRepository,
      developerRepository: deps.developerRepository ?? defaultDeveloperRepository,
    }),
  );
  router.use('/apis', apisRouter);
  router.use('/usage', usageRouter);
  router.use('/billing', billingRouter);

  return router;
}

export default createRoutes();
