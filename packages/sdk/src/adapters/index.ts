/**
 * Framework adapters for the Stele SDK.
 *
 * Re-exports all adapter factories and their associated types for
 * Express/HTTP, Vercel AI SDK, and LangChain integrations.
 *
 * @packageDocumentation
 */

// ─── Express / HTTP adapter ──────────────────────────────────────────────────

export {
  steleMiddleware,
  steleGuardHandler,
  createCovenantRouter,
} from './express.js';

export type {
  IncomingRequest,
  OutgoingResponse,
  NextFunction,
  SteleMiddlewareOptions,
  SteleGuardHandlerOptions,
  CovenantRouterOptions,
  CovenantRouter,
  AsyncHandler,
} from './express.js';

// ─── Vercel AI SDK adapter ───────────────────────────────────────────────────

export {
  SteleAccessDeniedError,
  withStele,
  withSteleTools,
  createToolGuard,
} from './vercel-ai.js';

export type {
  ToolLike,
  SteleToolOptions,
} from './vercel-ai.js';

// ─── LangChain adapter ──────────────────────────────────────────────────────

export {
  SteleCallbackHandler,
  withSteleTool,
  createChainGuard,
} from './langchain.js';

export type {
  LangChainToolLike,
  SteleLangChainOptions,
  CallbackEvent,
} from './langchain.js';
