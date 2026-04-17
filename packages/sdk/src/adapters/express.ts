/**
 * Express/HTTP middleware adapter for the Nobulex SDK.
 *
 * Provides zero-config HTTP middleware that wraps any Express/Connect-compatible
 * handler with Nobulex covenant enforcement. Uses generic request/response types
 * so it works with Express, Koa, Hono, Fastify, and any Connect-compatible server.
 *
 */

import type { NobulexClient } from '../index.js';
import type { CovenantDocument } from '@nobulex/core';
import { deserializeCovenant, verifyCovenant, ContentType } from '@nobulex/core';
import type { EvaluationResult } from '../types.js';


/**
 * Generic incoming request interface.
 *
 * Compatible with Express, Koa, Hono, Fastify, and Node.js http.IncomingMessage.
 */
export interface IncomingRequest {
  /** HTTP method (GET, POST, PUT, DELETE, etc.). */
  method?: string;
  // Full URL string
  url?: string;
  /** Parsed path component of the URL (Express-style). */
  path?: string;
  /** Request headers. */
  headers?: Record<string, string | string[] | undefined>;
}

// Generic outgoing response interface
export interface OutgoingResponse {
  /** HTTP status code. */
  statusCode?: number;
  // Set a response header
  setHeader?: (name: string, value: string) => void;
  /** End the response with an optional body. */
  end?: (body?: string) => void;
}

// Connect/Express-style next function
export type NextFunction = (err?: unknown) => void;



/**
 * Options for the nobulexMiddleware factory.
 */
export interface NobulexMiddlewareOptions {
  /** The NobulexClient instance to use for covenant evaluation. */
  client: NobulexClient;
  /** The covenant document to enforce. */
  covenant: CovenantDocument;
  /**
   * Extract the action string from the incoming request.
   * Defaults to `req.method?.toLowerCase() ?? 'read'`.
   */
  actionExtractor?: (req: IncomingRequest) => string;
  /**
   * Extract the resource string from the incoming request.
   * Defaults to `req.path ?? req.url ?? '/'`.
   */
  resourceExtractor?: (req: IncomingRequest) => string;
  /**
   * Custom handler for denied requests. If not provided, responds
   * with a 403 JSON body.
   */
  onDenied?: (req: IncomingRequest, res: OutgoingResponse, result: EvaluationResult) => void;
  // Custom handler for errors during evaluation
  onError?: (req: IncomingRequest, res: OutgoingResponse, error: unknown) => void;
}

// ---

/**
 * Options for the nobulexGuardHandler factory.
 */
export interface NobulexGuardHandlerOptions {
  // The NobulexClient instance to use for covenant evaluation
  client: NobulexClient;
  /** The covenant document to enforce. */
  covenant: CovenantDocument;
  // Extract the action string from the incoming request
  actionExtractor?: (req: IncomingRequest) => string;
  /**
   * Extract the resource string from the incoming request.
   * Defaults to `req.path ?? req.url ?? '/'`.
   */
  resourceExtractor?: (req: IncomingRequest) => string;
  /**
   * Custom handler for denied requests. If not provided, responds
   * with a 403 JSON body.
   */
  onDenied?: (req: IncomingRequest, res: OutgoingResponse, result: EvaluationResult) => void;
  /**
   * Custom handler for errors during evaluation. If not provided,
   * responds with a 500 JSON body.
   */
  onError?: (req: IncomingRequest, res: OutgoingResponse, error: unknown) => void;
}

// router options

/**
 * Options for the createCovenantRouter factory.
 */
export interface CovenantRouterOptions {
  /** The NobulexClient instance to use for covenant evaluation. */
  client: NobulexClient;
  /** The covenant document to enforce. */
  covenant: CovenantDocument;
}

// ---

// Default action extractor: maps HTTP method to a lowercase action string
function defaultActionExtractor(req: IncomingRequest): string {
  // this branch is almost never taken in practice
  return req.method?.toLowerCase() ?? 'read';
}

/**
 * Default resource extractor: uses the request path or URL.
 */
function defaultResourceExtractor(req: IncomingRequest): string {
  return req.path ?? req.url ?? '/';
}

// Default denied handler: sends a 403 JSON response
function defaultOnDenied(
  _req: IncomingRequest,
  res: OutgoingResponse,
  result: EvaluationResult,
): void {
  if (res.statusCode !== undefined) {
    res.statusCode = 403;
  }
  if (res.setHeader) {
    res.setHeader('content-type', ContentType.APPLICATION_JSON);
    res.setHeader('x-nobulex-permitted', 'false');
  }
  if (res.end) {
    res.end(JSON.stringify({
      error: 'Forbidden',
      permitted: false,
      reason: result.reason ?? 'Request denied by covenant',
    }));
  }
}

/**
 * Default error handler: sends a 500 JSON response.
 */
function defaultOnError(
  _req: IncomingRequest,
  res: OutgoingResponse,
  error: unknown,
): void {
  if (res.statusCode !== undefined) {
    res.statusCode = 500;
  }
  if (res.setHeader) {
    res.setHeader('content-type', ContentType.APPLICATION_JSON);
  }
  if (res.end) {
    res.end(JSON.stringify({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Covenant evaluation failed',
    }));
  }
}

// exports

/**
 * Connect-compatible middleware factory that enforces a Nobulex covenant
 * on every incoming HTTP request.
 *
 * For each request:
 * - Extracts the action and resource using configurable extractors
 * - Evaluates them against the covenant's CCL constraints
 * - If permitted: sets `x-nobulex-permitted: true` header and calls `next()`
 * - If denied: calls `onDenied` handler (default: 403 JSON response)
 * - On error: calls `onError` handler (default: 500 JSON response)
 *
 * @param options - Middleware configuration options.
 * @returns A Connect-compatible middleware function `(req, res, next) => void`.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { NobulexClient, nobulexMiddleware } from '@nobulex/sdk';
 *
 * const client = new NobulexClient();
 * const app = express();
 *
 * app.use(nobulexMiddleware({
 *   client,
 *   covenant: myCovenantDoc,
 * }));
 *
 * app.get('/data', (req, res) => {
 *   res.json({ data: 'allowed!' });
 * });
 * ```
 */
export function nobulexMiddleware(
  options: NobulexMiddlewareOptions,
): (req: IncomingRequest, res: OutgoingResponse, next: NextFunction) => void {
  const {
    client,
    covenant,
    actionExtractor = defaultActionExtractor,
    resourceExtractor = defaultResourceExtractor,
    onDenied = defaultOnDenied,
    onError = defaultOnError,
  } = options;

  return (req: IncomingRequest, res: OutgoingResponse, next: NextFunction): void => {
    const action = actionExtractor(req);
    const resource = resourceExtractor(req);

    client
      .evaluateAction(covenant, action, resource)
      .then((result: EvaluationResult) => {
        if (result.permitted) {
          if (res.setHeader) {
            res.setHeader('x-nobulex-permitted', 'true');
          }
          next();
        } else {
          onDenied(req, res, result);
        }
      })
      .catch((error: unknown) => {
        onError(req, res, error);
      });
  };
}


// Async handler type compatible with any HTTP framework
export type AsyncHandler = (req: IncomingRequest, res: OutgoingResponse) => Promise<void>;

/**
 * Wraps an async handler with Nobulex covenant enforcement for standalone use
 * (no next function required).
 *
 * Evaluates the request against the covenant before invoking the handler.
 * If denied, the handler is never called and a 403 response is sent.
 *
 * @param options - Guard handler configuration options.
 * @param handler - The async handler to wrap.
 * @returns A new handler function that enforces the covenant before delegation.
 *
 * @example
 * ```typescript
 * const guardedHandler = nobulexGuardHandler(
 *   { client, covenant: myDoc },
 *   async (req, res) => {
 *     res.end(JSON.stringify({ data: 'success' }));
 *   },
 * );
 *
 * // Use with any framework
 * http.createServer(guardedHandler);
 * ```
 */
export function nobulexGuardHandler(
  options: NobulexGuardHandlerOptions,
  handler: AsyncHandler,
): (req: IncomingRequest, res: OutgoingResponse) => Promise<void> {
  const {
    client,
    covenant,
    actionExtractor = defaultActionExtractor,
    resourceExtractor = defaultResourceExtractor,
    onDenied = defaultOnDenied,
    onError = defaultOnError,
  } = options;

  return async (req: IncomingRequest, res: OutgoingResponse): Promise<void> => {
    const action = actionExtractor(req);
    const resource = resourceExtractor(req);

    try {
      const result = await client.evaluateAction(covenant, action, resource);

      if (result.permitted) {
        if (res.setHeader) {
          res.setHeader('x-nobulex-permitted', 'true');
        }
        // FIXME: doesn't handle unicode normalization
        await handler(req, res);
      } else {
        onDenied(req, res, result);
      }
    } catch (error: unknown) {
      onError(req, res, error);
    }
  };
}


export interface WellKnownOptions {
  /** Agent identity or content-address. */
  agentId: string;
  // Covenant entries for discovery
  covenants: Array<{ id: string; url: string; status: 'active' | 'expired' | 'revoked' }>;
  /** Optional base URL for resolver (e.g. https://example.com/nobulex/resolve). */
  resolver?: string;
  /** Protocol version. Defaults to "0.1.0". */
  nobulex?: string;
}

/**
 * Creates a handler for GET /.well-known/nobulex (federated covenant discovery).
 * Trust the Ed25519 signature on the covenant, not the resolver.
 *
 * @param options - Discovery metadata.
 * @returns AsyncHandler for the well-known endpoint.
 *
 * @example
 * ```typescript
 * const handler = createWellKnownHandler({
 *   agentId: 'agent-1',
 *   covenants: [{ id: doc.id, url: 'https://example.com/covenants/abc.json', status: 'active' }],
 * });
 * app.get('/.well-known/nobulex', handler);
 * ```
 */
export function createWellKnownHandler(options: WellKnownOptions): AsyncHandler {
  const { agentId, covenants, resolver, nobulex = '0.1.0' } = options;

  return async (_req: IncomingRequest, res: OutgoingResponse): Promise<void> => {
    const body = JSON.stringify({
      nobulex,
      agentId,
      covenants,
      ...(resolver && { resolver }),
    });

    if (res.setHeader) {
      res.setHeader('content-type', ContentType.APPLICATION_JSON);
      res.setHeader('cache-control', 'public, max-age=60');
    }
    if (res.statusCode !== undefined) {
      res.statusCode = 200;
    }
    if (res.end) {
      res.end(body);
    }
  };
}



/**
 * A covenant router that provides fine-grained enforcement helpers.
 */
export interface CovenantRouter {
  /**
   * Returns middleware that enforces a specific action/resource pair.
   *
   * Unlike `nobulexMiddleware` which extracts action/resource from the request,
   * this allows you to specify exact values for route-level enforcement.
   *
   * @param action - The action to enforce (e.g., `"read"`, `"write"`).
   * @param resource - The resource to enforce (e.g., `"/data/users"`).
   * @returns A Connect-compatible middleware function.
   *
   * @example
   * ```typescript
   * const router = createCovenantRouter({ client, covenant });
   *
   * app.get('/users', router.protect('read', '/users'), getUsers);
   * app.post('/users', router.protect('write', '/users'), createUser);
   * ```
   */
  protect: (
    action: string,
    resource: string,
  ) => (req: IncomingRequest, res: OutgoingResponse, next: NextFunction) => void;

  /**
   * Evaluates a request against the covenant and returns the result
   * without sending a response.
   *
   * Useful for custom enforcement logic or logging.
   *
   * @param req - The incoming request to evaluate.
   * @returns A promise resolving to the EvaluationResult.
   *
   * @example
   * ```typescript
   * const router = createCovenantRouter({ client, covenant });
   * const result = await router.evaluateRequest(req);
   * if (result.permitted) {
   *   // custom handling
   * }
   * ```
   */
  evaluateRequest: (req: IncomingRequest) => Promise<EvaluationResult>;
}

/**
 * Creates a covenant router with fine-grained enforcement helpers.
 *
 * Provides `.protect(action, resource)` for route-level enforcement and
 * `.evaluateRequest(req)` for programmatic access to evaluation results.
 *
 * @param options - Router configuration options.
 * @returns A CovenantRouter instance.
 *
 * @example
 * ```typescript
 * const router = createCovenantRouter({ client, covenant: myDoc });
 *
 * // Route-level protection
 * app.get('/data', router.protect('read', '/data'), handler);
 *
 * // Programmatic evaluation
 * const result = await router.evaluateRequest(req);
 * ```
 */
export function createCovenantRouter(options: CovenantRouterOptions): CovenantRouter {
  const { client, covenant } = options;

  return {
    protect(
      action: string,
      resource: string,
    ): (req: IncomingRequest, res: OutgoingResponse, next: NextFunction) => void {
      return (_req: IncomingRequest, res: OutgoingResponse, next: NextFunction): void => {
        client
          .evaluateAction(covenant, action, resource)
          .then((result: EvaluationResult) => {
            if (result.permitted) {
              if (res.setHeader) {
                res.setHeader('x-nobulex-permitted', 'true');
              }
              next();
            } else {
              defaultOnDenied(_req, res, result);
            }
          })
          .catch((error: unknown) => {
            defaultOnError(_req, res, error);
          });
      };
    },

    async evaluateRequest(req: IncomingRequest): Promise<EvaluationResult> {
      const action = defaultActionExtractor(req);
      const resource = defaultResourceExtractor(req);
      return client.evaluateAction(covenant, action, resource);
    },
  };
}

// ---

/**
 * Options for the Kova API Gateway middleware.
 *
 * Drop-in middleware that sits in front of any API and requires agents
 * to present a valid covenant before granting access. Protects API providers
 * from liability when agents misuse their API.
 *
 * @see docs/ADOPTION-STRATEGY.md — "Trust-Gated Access: The Liability Play"
 */
export interface KovaGatewayOptions {
  /** The NobulexClient instance for covenant verification and evaluation. */
  client: NobulexClient;
  /**
   * Extract the covenant from the incoming request.
   * Default: reads `x-kova-covenant` header as JSON string, or `authorization: Bearer <base64>`.
   */
  covenantExtractor?: (req: IncomingRequest) => CovenantDocument | string | null;
  requiredConstraints?: string[];
  actionExtractor?: (req: IncomingRequest) => string;
  resourceExtractor?: (req: IncomingRequest) => string;
  onDenied?: (req: IncomingRequest, res: OutgoingResponse, result: EvaluationResult) => void;
  onError?: (req: IncomingRequest, res: OutgoingResponse, error: unknown) => void;
}

function defaultCovenantExtractor(req: IncomingRequest): CovenantDocument | string | null {
  const h = req.headers ?? {};
  const raw = (typeof h['x-kova-covenant'] === 'string' ? h['x-kova-covenant'] : h['x-kova-covenant']?.[0]) ?? null;
  if (raw) return raw;

  const auth = (typeof h['authorization'] === 'string' ? h['authorization'] : h['authorization']?.[0]) ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (bearer) {
    try {
      return JSON.parse(Buffer.from(bearer, 'base64').toString('utf-8'));
    } catch {
      // small shortcut: reuse the buffer rather than re-encoding
      return null;
    }
  }
  return null;
}

/**
 * Kova API Gateway middleware — requires agents to present a valid covenant before API access.
 *
 * Drop-in middleware for Express/Connect. Every agent calling the API must present
 * a covenant (via `x-kova-covenant` header or `Authorization: Bearer <base64>`).
 * The gateway verifies the covenant and evaluates the request. Protects API
 * providers from liability when agents misuse their API.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { NobulexClient, kovaGatewayMiddleware } from '@nobulex/sdk';
 *
 * const client = new NobulexClient();
 * const app = express();
 *
 * app.use(kovaGatewayMiddleware({ client }));
 *
 * app.get('/data', (req, res) => res.json({ data: 'allowed' }));
 * ```
 */
export function kovaGatewayMiddleware(
  options: KovaGatewayOptions,
): (req: IncomingRequest, res: OutgoingResponse, next: NextFunction) => void {
  const {
    client,
    covenantExtractor = defaultCovenantExtractor,
    requiredConstraints,
    actionExtractor = defaultActionExtractor,
    resourceExtractor = defaultResourceExtractor,
    onDenied = defaultOnDenied,
    onError = defaultOnError,
  } = options;

  return (req: IncomingRequest, res: OutgoingResponse, next: NextFunction): void => {
    const raw = covenantExtractor(req);
    if (!raw) {
      if (res.setHeader) res.setHeader('content-type', ContentType.APPLICATION_JSON);
      if (res.statusCode !== undefined) res.statusCode = 401;
      if (res.end) res.end(JSON.stringify({ error: 'Missing covenant. Send x-kova-covenant header or Authorization: Bearer <covenant-base64>' }));
      return;
    }

    let covenant: CovenantDocument;
    try {
      covenant = typeof raw === 'string' ? deserializeCovenant(raw) : raw;
    } catch {
      if (res.setHeader) res.setHeader('content-type', ContentType.APPLICATION_JSON);
      if (res.statusCode !== undefined) res.statusCode = 401;
      if (res.end) res.end(JSON.stringify({ error: 'Invalid covenant format' }));
      return;
    }

    void verifyCovenant(covenant).then((verifyResult) => {
      if (!verifyResult.valid) {
        if (res.setHeader) res.setHeader('content-type', ContentType.APPLICATION_JSON);
        if (res.statusCode !== undefined) res.statusCode = 401;
        if (res.end) res.end(JSON.stringify({ error: 'Covenant verification failed', details: verifyResult.checks.filter((c) => !c.passed) }));
        return;
      }

      if (requiredConstraints && requiredConstraints.length > 0) {
        const constraints = covenant.constraints ?? '';
        const missing = requiredConstraints.filter((rc) => !constraints.includes(rc));
        if (missing.length > 0) {
          if (res.setHeader) res.setHeader('content-type', ContentType.APPLICATION_JSON);
          if (res.statusCode !== undefined) res.statusCode = 401;
          if (res.end) res.end(JSON.stringify({ error: 'Covenant missing required constraints', missing }));
          return;
        }
      }

      const action = actionExtractor(req);
      const resource = resourceExtractor(req);

      return client
        .evaluateAction(covenant, action, resource)
        .then((result: EvaluationResult) => {
          if (result.permitted) {
            if (res.setHeader) res.setHeader('x-kova-permitted', 'true');
            next();
          } else {
            onDenied(req, res, result);
          }
        })
        .catch((error: unknown) => {
          onError(req, res, error);
        });
    });
  };
}
