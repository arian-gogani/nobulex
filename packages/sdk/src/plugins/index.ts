/**
 * Built-in plugins for the Stele SDK middleware system.
 *
 * Re-exports all plugin factories and their associated types.
 *
 * @packageDocumentation
 */

export { cachingMiddleware } from './cache.js';
export type { CacheOptions, CacheStats } from './cache.js';

export { authMiddleware } from './auth.js';
export type { AuthOptions } from './auth.js';

export { metricsMiddleware } from './metrics-plugin.js';
export type { MetricsPluginOptions } from './metrics-plugin.js';

export { retryMiddleware, executeWithRetry } from './retry-plugin.js';
export type { RetryPluginOptions } from './retry-plugin.js';
