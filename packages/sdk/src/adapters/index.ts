/**
 * Framework adapters for the Nobulex SDK.
 *
 * Re-exports all adapter factories and their associated types for
 * Express/HTTP, Vercel AI SDK, and LangChain integrations.
 *
 * @packageDocumentation
 */

// ─── Express / HTTP adapter ──────────────────────────────────────────────────

export {
  nobulexMiddleware,
  nobulexGuardHandler,
  createCovenantRouter,
  createWellKnownHandler,
  kovaGatewayMiddleware,
} from './express.js';

export type {
  IncomingRequest,
  OutgoingResponse,
  NextFunction,
  NobulexMiddlewareOptions,
  NobulexGuardHandlerOptions,
  CovenantRouterOptions,
  CovenantRouter,
  AsyncHandler,
  WellKnownOptions,
  KovaGatewayOptions,
} from './express.js';

// ─── Vercel AI SDK adapter ───────────────────────────────────────────────────

export {
  NobulexAccessDeniedError,
  withNobulex,
  withNobulexTools,
  createToolGuard,
} from './vercel-ai.js';

export type {
  ToolLike,
  NobulexToolOptions,
} from './vercel-ai.js';

// ─── LangChain adapter ──────────────────────────────────────────────────────

export {
  NobulexCallbackHandler,
  withNobulexTool,
  createChainGuard,
} from './langchain.js';

export type {
  LangChainToolLike,
  NobulexLangChainOptions,
  CallbackEvent,
} from './langchain.js';
