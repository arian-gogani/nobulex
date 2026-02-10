import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPair } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';
import type { CovenantDocument, Issuer, Beneficiary } from '@stele/core';

import {
  SteleClient,
  steleMiddleware,
  steleGuardHandler,
  createCovenantRouter,
} from '../../src/index.js';

import type {
  IncomingRequest,
  OutgoingResponse,
  NextFunction,
  EvaluationResult,
} from '../../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeParties(): Promise<{
  issuerKeyPair: KeyPair;
  beneficiaryKeyPair: KeyPair;
  issuer: Issuer;
  beneficiary: Beneficiary;
}> {
  const issuerKeyPair = await generateKeyPair();
  const beneficiaryKeyPair = await generateKeyPair();

  const issuer: Issuer = {
    id: 'issuer-1',
    publicKey: issuerKeyPair.publicKeyHex,
    role: 'issuer',
  };

  const beneficiary: Beneficiary = {
    id: 'beneficiary-1',
    publicKey: beneficiaryKeyPair.publicKeyHex,
    role: 'beneficiary',
  };

  return { issuerKeyPair, beneficiaryKeyPair, issuer, beneficiary };
}

/** Create a mock request object. */
function mockRequest(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    method: 'GET',
    url: '/data',
    path: '/data',
    headers: {},
    ...overrides,
  };
}

/** Create a mock response object with spies. */
function mockResponse(): OutgoingResponse & {
  _statusCode: number;
  _headers: Record<string, string>;
  _body: string | undefined;
} {
  const res = {
    _statusCode: 200,
    _headers: {} as Record<string, string>,
    _body: undefined as string | undefined,
    get statusCode() {
      return res._statusCode;
    },
    set statusCode(code: number) {
      res._statusCode = code;
    },
    setHeader: vi.fn((name: string, value: string) => {
      res._headers[name] = value;
    }),
    end: vi.fn((body?: string) => {
      res._body = body;
    }),
  };
  return res;
}

/** Helper: create a client and covenant for tests. */
async function createTestFixture(constraints: string): Promise<{
  client: SteleClient;
  covenant: CovenantDocument;
}> {
  const { issuerKeyPair, issuer, beneficiary } = await makeParties();
  const client = new SteleClient({ keyPair: issuerKeyPair });

  const covenant = await client.createCovenant({
    issuer,
    beneficiary,
    constraints,
  });

  return { client, covenant };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Express/HTTP middleware adapter', () => {
  // ── steleMiddleware ─────────────────────────────────────────────────

  describe('steleMiddleware', () => {
    it('calls next() and sets header for permitted requests', async () => {
      const { client, covenant } = await createTestFixture(
        "permit get on '/data'",
      );

      const middleware = steleMiddleware({ client, covenant });

      const req = mockRequest({ method: 'GET', path: '/data' });
      const res = mockResponse();
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);

      // Wait for the async evaluation to complete
      await vi.waitFor(() => {
        expect(next).toHaveBeenCalledTimes(1);
      });

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('x-stele-permitted', 'true');
    });

    it('sends 403 for denied requests', async () => {
      const { client, covenant } = await createTestFixture(
        "deny get on '/secret'",
      );

      const middleware = steleMiddleware({ client, covenant });

      const req = mockRequest({ method: 'GET', path: '/secret' });
      const res = mockResponse();
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(res.end).toHaveBeenCalled();
      });

      expect(next).not.toHaveBeenCalled();
      expect(res._statusCode).toBe(403);
      expect(res._headers['content-type']).toBe('application/json');
      expect(res._headers['x-stele-permitted']).toBe('false');

      const body = JSON.parse(res._body!);
      expect(body.error).toBe('Forbidden');
      expect(body.permitted).toBe(false);
    });

    it('sends 403 for unmatched requests (default deny)', async () => {
      const { client, covenant } = await createTestFixture(
        "permit read on '/allowed'",
      );

      const middleware = steleMiddleware({ client, covenant });

      // POST to /allowed won't match the 'read' permit
      const req = mockRequest({ method: 'POST', path: '/allowed' });
      const res = mockResponse();
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(res.end).toHaveBeenCalled();
      });

      expect(next).not.toHaveBeenCalled();
      expect(res._statusCode).toBe(403);
    });

    it('uses custom actionExtractor', async () => {
      const { client, covenant } = await createTestFixture(
        "permit file.upload on '/data'",
      );

      const middleware = steleMiddleware({
        client,
        covenant,
        actionExtractor: () => 'file.upload',
      });

      const req = mockRequest({ method: 'GET', path: '/data' });
      const res = mockResponse();
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalledTimes(1);
      });

      expect(res.setHeader).toHaveBeenCalledWith('x-stele-permitted', 'true');
    });

    it('uses custom resourceExtractor', async () => {
      const { client, covenant } = await createTestFixture(
        "permit get on '/custom/resource'",
      );

      const middleware = steleMiddleware({
        client,
        covenant,
        resourceExtractor: () => '/custom/resource',
      });

      const req = mockRequest({ method: 'GET', path: '/whatever' });
      const res = mockResponse();
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalledTimes(1);
      });

      expect(res.setHeader).toHaveBeenCalledWith('x-stele-permitted', 'true');
    });

    it('uses custom onDenied handler', async () => {
      const { client, covenant } = await createTestFixture(
        "deny get on '/secret'",
      );

      const onDenied = vi.fn();

      const middleware = steleMiddleware({
        client,
        covenant,
        onDenied,
      });

      const req = mockRequest({ method: 'GET', path: '/secret' });
      const res = mockResponse();
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(onDenied).toHaveBeenCalledTimes(1);
      });

      expect(next).not.toHaveBeenCalled();
      expect(onDenied).toHaveBeenCalledWith(req, res, expect.objectContaining({
        permitted: false,
      }));
    });

    it('uses custom onError handler', async () => {
      const { client, covenant } = await createTestFixture(
        "permit get on '/data'",
      );

      const onError = vi.fn();

      // Force an error by stubbing evaluateAction
      vi.spyOn(client, 'evaluateAction').mockRejectedValueOnce(
        new Error('evaluation failed'),
      );

      const middleware = steleMiddleware({
        client,
        covenant,
        onError,
      });

      const req = mockRequest({ method: 'GET', path: '/data' });
      const res = mockResponse();
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1);
      });

      expect(next).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(req, res, expect.any(Error));
    });

    it('sends 500 on error with default handler', async () => {
      const { client, covenant } = await createTestFixture(
        "permit get on '/data'",
      );

      vi.spyOn(client, 'evaluateAction').mockRejectedValueOnce(
        new Error('boom'),
      );

      const middleware = steleMiddleware({ client, covenant });

      const req = mockRequest({ method: 'GET', path: '/data' });
      const res = mockResponse();
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(res.end).toHaveBeenCalled();
      });

      expect(next).not.toHaveBeenCalled();
      expect(res._statusCode).toBe(500);

      const body = JSON.parse(res._body!);
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toBe('boom');
    });

    it('defaults action to method lowercase', async () => {
      const { client, covenant } = await createTestFixture(
        "permit post on '/items'",
      );

      const middleware = steleMiddleware({ client, covenant });

      const req = mockRequest({ method: 'POST', path: '/items' });
      const res = mockResponse();
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalledTimes(1);
      });
    });

    it('defaults resource to url when path is missing', async () => {
      const { client, covenant } = await createTestFixture(
        "permit get on '/from-url'",
      );

      const middleware = steleMiddleware({ client, covenant });

      const req = mockRequest({ method: 'GET', url: '/from-url', path: undefined });
      const res = mockResponse();
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ── steleGuardHandler ──────────────────────────────────────────────

  describe('steleGuardHandler', () => {
    it('calls the handler for permitted requests', async () => {
      const { client, covenant } = await createTestFixture(
        "permit get on '/data'",
      );

      const handler = vi.fn(async (_req: IncomingRequest, _res: OutgoingResponse) => {
        // handler body
      });

      const guarded = steleGuardHandler({ client, covenant }, handler);

      const req = mockRequest({ method: 'GET', path: '/data' });
      const res = mockResponse();

      await guarded(req, res);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(req, res);
      expect(res.setHeader).toHaveBeenCalledWith('x-stele-permitted', 'true');
    });

    it('does not call the handler for denied requests', async () => {
      const { client, covenant } = await createTestFixture(
        "deny get on '/secret'",
      );

      const handler = vi.fn(async () => {});

      const guarded = steleGuardHandler({ client, covenant }, handler);

      const req = mockRequest({ method: 'GET', path: '/secret' });
      const res = mockResponse();

      await guarded(req, res);

      expect(handler).not.toHaveBeenCalled();
      expect(res._statusCode).toBe(403);
    });

    it('uses custom onDenied for denied requests', async () => {
      const { client, covenant } = await createTestFixture(
        "deny get on '/secret'",
      );

      const onDenied = vi.fn();
      const handler = vi.fn(async () => {});

      const guarded = steleGuardHandler(
        { client, covenant, onDenied },
        handler,
      );

      const req = mockRequest({ method: 'GET', path: '/secret' });
      const res = mockResponse();

      await guarded(req, res);

      expect(handler).not.toHaveBeenCalled();
      expect(onDenied).toHaveBeenCalledWith(req, res, expect.objectContaining({
        permitted: false,
      }));
    });

    it('handles errors with default error handler', async () => {
      const { client, covenant } = await createTestFixture(
        "permit get on '/data'",
      );

      vi.spyOn(client, 'evaluateAction').mockRejectedValueOnce(
        new Error('guard error'),
      );

      const handler = vi.fn(async () => {});

      const guarded = steleGuardHandler({ client, covenant }, handler);

      const req = mockRequest({ method: 'GET', path: '/data' });
      const res = mockResponse();

      await guarded(req, res);

      expect(handler).not.toHaveBeenCalled();
      expect(res._statusCode).toBe(500);

      const body = JSON.parse(res._body!);
      expect(body.message).toBe('guard error');
    });

    it('handles errors with custom onError handler', async () => {
      const { client, covenant } = await createTestFixture(
        "permit get on '/data'",
      );

      const onError = vi.fn();

      vi.spyOn(client, 'evaluateAction').mockRejectedValueOnce(
        new Error('custom error'),
      );

      const handler = vi.fn(async () => {});

      const guarded = steleGuardHandler(
        { client, covenant, onError },
        handler,
      );

      const req = mockRequest({ method: 'GET', path: '/data' });
      const res = mockResponse();

      await guarded(req, res);

      expect(handler).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(req, res, expect.any(Error));
    });

    it('uses custom extractors', async () => {
      const { client, covenant } = await createTestFixture(
        "permit custom on '/custom'",
      );

      const handler = vi.fn(async () => {});

      const guarded = steleGuardHandler(
        {
          client,
          covenant,
          actionExtractor: () => 'custom',
          resourceExtractor: () => '/custom',
        },
        handler,
      );

      const req = mockRequest({ method: 'GET', path: '/whatever' });
      const res = mockResponse();

      await guarded(req, res);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── createCovenantRouter ───────────────────────────────────────────

  describe('createCovenantRouter', () => {
    describe('.protect()', () => {
      it('permits when action/resource are allowed', async () => {
        const { client, covenant } = await createTestFixture(
          "permit read on '/users'",
        );

        const router = createCovenantRouter({ client, covenant });
        const protectMiddleware = router.protect('read', '/users');

        const req = mockRequest();
        const res = mockResponse();
        const next = vi.fn() as unknown as NextFunction;

        protectMiddleware(req, res, next);

        await vi.waitFor(() => {
          expect(next).toHaveBeenCalledTimes(1);
        });

        expect(res.setHeader).toHaveBeenCalledWith('x-stele-permitted', 'true');
      });

      it('denies when action/resource are not allowed', async () => {
        const { client, covenant } = await createTestFixture(
          "deny write on '/users'",
        );

        const router = createCovenantRouter({ client, covenant });
        const protectMiddleware = router.protect('write', '/users');

        const req = mockRequest();
        const res = mockResponse();
        const next = vi.fn() as unknown as NextFunction;

        protectMiddleware(req, res, next);

        await vi.waitFor(() => {
          expect(res.end).toHaveBeenCalled();
        });

        expect(next).not.toHaveBeenCalled();
        expect(res._statusCode).toBe(403);
      });

      it('denies by default when no matching rule', async () => {
        const { client, covenant } = await createTestFixture(
          "permit read on '/other'",
        );

        const router = createCovenantRouter({ client, covenant });
        const protectMiddleware = router.protect('write', '/users');

        const req = mockRequest();
        const res = mockResponse();
        const next = vi.fn() as unknown as NextFunction;

        protectMiddleware(req, res, next);

        await vi.waitFor(() => {
          expect(res.end).toHaveBeenCalled();
        });

        expect(next).not.toHaveBeenCalled();
        expect(res._statusCode).toBe(403);
      });

      it('handles errors with a 500 response', async () => {
        const { client, covenant } = await createTestFixture(
          "permit read on '/users'",
        );

        vi.spyOn(client, 'evaluateAction').mockRejectedValueOnce(
          new Error('router error'),
        );

        const router = createCovenantRouter({ client, covenant });
        const protectMiddleware = router.protect('read', '/users');

        const req = mockRequest();
        const res = mockResponse();
        const next = vi.fn() as unknown as NextFunction;

        protectMiddleware(req, res, next);

        await vi.waitFor(() => {
          expect(res.end).toHaveBeenCalled();
        });

        expect(next).not.toHaveBeenCalled();
        expect(res._statusCode).toBe(500);
      });
    });

    describe('.evaluateRequest()', () => {
      it('returns permitted result for matching request', async () => {
        const { client, covenant } = await createTestFixture(
          "permit get on '/data'",
        );

        const router = createCovenantRouter({ client, covenant });

        const req = mockRequest({ method: 'GET', path: '/data' });
        const result = await router.evaluateRequest(req);

        expect(result.permitted).toBe(true);
      });

      it('returns denied result for non-matching request', async () => {
        const { client, covenant } = await createTestFixture(
          "deny post on '/data'",
        );

        const router = createCovenantRouter({ client, covenant });

        const req = mockRequest({ method: 'POST', path: '/data' });
        const result = await router.evaluateRequest(req);

        expect(result.permitted).toBe(false);
      });

      it('uses method and path from request for evaluation', async () => {
        const { client, covenant } = await createTestFixture(
          "permit delete on '/items'",
        );

        const router = createCovenantRouter({ client, covenant });

        const req = mockRequest({ method: 'DELETE', path: '/items' });
        const result = await router.evaluateRequest(req);

        expect(result.permitted).toBe(true);
      });

      it('falls back to url when path is undefined', async () => {
        const { client, covenant } = await createTestFixture(
          "permit get on '/url-path'",
        );

        const router = createCovenantRouter({ client, covenant });

        const req = mockRequest({ method: 'GET', url: '/url-path', path: undefined });
        const result = await router.evaluateRequest(req);

        expect(result.permitted).toBe(true);
      });

      it('defaults action to read when method is undefined', async () => {
        const { client, covenant } = await createTestFixture(
          "permit read on '/data'",
        );

        const router = createCovenantRouter({ client, covenant });

        const req = mockRequest({ method: undefined, path: '/data' });
        const result = await router.evaluateRequest(req);

        expect(result.permitted).toBe(true);
      });

      it('defaults resource to / when both path and url are undefined', async () => {
        const { client, covenant } = await createTestFixture(
          "permit get on '/'",
        );

        const router = createCovenantRouter({ client, covenant });

        const req = mockRequest({ method: 'GET', path: undefined, url: undefined });
        const result = await router.evaluateRequest(req);

        expect(result.permitted).toBe(true);
      });
    });
  });

  // ── Integration tests ──────────────────────────────────────────────

  describe('integration', () => {
    it('middleware works with multi-rule covenant', async () => {
      const { client, covenant } = await createTestFixture(
        "permit get on '/data/**'\ndeny delete on '/data/**'",
      );

      const middleware = steleMiddleware({ client, covenant });

      // GET should be permitted
      const reqGet = mockRequest({ method: 'GET', path: '/data/users' });
      const resGet = mockResponse();
      const nextGet = vi.fn() as unknown as NextFunction;

      middleware(reqGet, resGet, nextGet);

      await vi.waitFor(() => {
        expect(nextGet).toHaveBeenCalledTimes(1);
      });

      // DELETE should be denied
      const reqDel = mockRequest({ method: 'DELETE', path: '/data/users' });
      const resDel = mockResponse();
      const nextDel = vi.fn() as unknown as NextFunction;

      middleware(reqDel, resDel, nextDel);

      await vi.waitFor(() => {
        expect(resDel.end).toHaveBeenCalled();
      });

      expect(nextDel).not.toHaveBeenCalled();
      expect(resDel._statusCode).toBe(403);
    });

    it('guard handler works with wildcard resources', async () => {
      const { client, covenant } = await createTestFixture(
        "permit get on '/api/**'",
      );

      const handler = vi.fn(async (_req: IncomingRequest, res: OutgoingResponse) => {
        if (res.end) {
          res.end(JSON.stringify({ ok: true }));
        }
      });

      const guarded = steleGuardHandler({ client, covenant }, handler);

      const req = mockRequest({ method: 'GET', path: '/api/v1/items' });
      const res = mockResponse();

      await guarded(req, res);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(res._body).toBe(JSON.stringify({ ok: true }));
    });

    it('router protect and evaluateRequest agree on results', async () => {
      const { client, covenant } = await createTestFixture(
        "permit read on '/reports'\ndeny write on '/reports'",
      );

      const router = createCovenantRouter({ client, covenant });

      // evaluateRequest returns permitted
      const readReq = mockRequest({ method: 'read', path: '/reports' });
      const readResult = await router.evaluateRequest(readReq);
      expect(readResult.permitted).toBe(true);

      // protect middleware also permits
      const protectRead = router.protect('read', '/reports');
      const res1 = mockResponse();
      const next1 = vi.fn() as unknown as NextFunction;
      protectRead(mockRequest(), res1, next1);

      await vi.waitFor(() => {
        expect(next1).toHaveBeenCalledTimes(1);
      });

      // evaluateRequest returns denied
      const writeReq = mockRequest({ method: 'write', path: '/reports' });
      const writeResult = await router.evaluateRequest(writeReq);
      expect(writeResult.permitted).toBe(false);

      // protect middleware also denies
      const protectWrite = router.protect('write', '/reports');
      const res2 = mockResponse();
      const next2 = vi.fn() as unknown as NextFunction;
      protectWrite(mockRequest(), res2, next2);

      await vi.waitFor(() => {
        expect(res2.end).toHaveBeenCalled();
      });

      expect(next2).not.toHaveBeenCalled();
    });
  });
});
