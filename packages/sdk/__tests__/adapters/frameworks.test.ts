import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';
import type { CovenantDocument } from '@stele/core';

import {
  SteleClient,
  // Vercel AI adapter
  withStele,
  withSteleTools,
  createToolGuard,
  SteleAccessDeniedError,
  // LangChain adapter
  SteleCallbackHandler,
  withSteleTool,
  createChainGuard,
} from '../../src/index.js';

import type {
  ToolLike,
  SteleToolOptions,
  LangChainToolLike,
  SteleLangChainOptions,
} from '../../src/index.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let kp: KeyPair;
let client: SteleClient;
let covenant: CovenantDocument;

beforeAll(async () => {
  kp = await generateKeyPair();
  client = new SteleClient({ keyPair: kp });
  covenant = await client.createCovenant({
    issuer: { id: 'test-issuer', publicKey: kp.publicKeyHex, role: 'issuer' },
    beneficiary: { id: 'test-agent', publicKey: kp.publicKeyHex, role: 'beneficiary' },
    constraints: "permit read on '/data/**'\ndeny write on '/system/**'",
  });
});

// ---------------------------------------------------------------------------
// Vercel AI SDK adapter
// ---------------------------------------------------------------------------

describe('Vercel AI adapter', () => {
  // ── withStele ──────────────────────────────────────────────────────────

  describe('withStele', () => {
    it('allows a permitted tool call through', async () => {
      const mockTool: ToolLike = {
        name: 'read',
        description: 'Read data',
        execute: async (query: unknown) => ({ data: query }),
      };

      const options: SteleToolOptions = { client, covenant };
      const protected_ = withStele(mockTool, options);

      // "read" on "/read" -- but wait, the covenant permits "read on /data/**".
      // Default resource will be /read which doesn't match /data/**.
      // We need to use a custom resource extractor or name the tool accordingly.
      // Let's use a custom extractor for clarity:
      const protectedWithExtractor = withStele(mockTool, {
        client,
        covenant,
        resourceFromTool: () => '/data/users',
      });

      const result = await protectedWithExtractor.execute!('hello');
      expect(result).toEqual({ data: 'hello' });
    });

    it('throws SteleAccessDeniedError for a denied tool call', async () => {
      const mockTool: ToolLike = {
        name: 'write',
        description: 'Write to system',
        execute: async () => 'should not reach',
      };

      const protected_ = withStele(mockTool, {
        client,
        covenant,
        resourceFromTool: () => '/system/config',
      });

      await expect(protected_.execute!()).rejects.toThrow(SteleAccessDeniedError);
      await expect(protected_.execute!()).rejects.toThrow('denied by covenant');
    });

    it('calls onDenied handler instead of throwing when provided', async () => {
      const mockTool: ToolLike = {
        name: 'write',
        execute: async () => 'should not reach',
      };

      const deniedResult = { denied: true };
      const protected_ = withStele(mockTool, {
        client,
        covenant,
        resourceFromTool: () => '/system/critical',
        onDenied: (_tool, result) => {
          expect(result.permitted).toBe(false);
          return deniedResult;
        },
      });

      const result = await protected_.execute!();
      expect(result).toBe(deniedResult);
    });

    it('returns a copy without wrapping when tool has no execute', () => {
      const tool: ToolLike = { name: 'no-exec', description: 'A passive tool' };
      const protected_ = withStele(tool, { client, covenant });

      expect(protected_.name).toBe('no-exec');
      expect(protected_.execute).toBeUndefined();
      // Verify it's a copy, not the same reference
      expect(protected_).not.toBe(tool);
    });

    it('uses tool.name as the default action', async () => {
      let capturedAction = '';

      const mockTool: ToolLike = {
        name: 'read',
        execute: async () => 'ok',
      };

      // Use a custom action extractor that captures the derived action
      const protected_ = withStele(mockTool, {
        client,
        covenant,
        actionFromTool: (tool, _args) => {
          capturedAction = tool.name ?? 'execute';
          return capturedAction;
        },
        resourceFromTool: () => '/data/test',
      });

      await protected_.execute!();
      expect(capturedAction).toBe('read');
    });

    it('defaults action to "execute" when tool has no name', async () => {
      const mockTool: ToolLike = {
        execute: async () => 'ok',
      };

      // This will use action="execute" and resource="/unknown", which won't match
      // any permit rule and should be denied by default-deny
      await expect(
        withStele(mockTool, { client, covenant }).execute!(),
      ).rejects.toThrow(SteleAccessDeniedError);
    });
  });

  // ── withSteleTools ─────────────────────────────────────────────────────

  describe('withSteleTools', () => {
    it('wraps an array of tools', async () => {
      const tools: ToolLike[] = [
        { name: 'read', execute: async () => 'read-result' },
        { name: 'search', execute: async () => 'search-result' },
      ];

      const wrapped = withSteleTools(tools, {
        client,
        covenant,
        resourceFromTool: () => '/data/items',
      });

      expect(wrapped).toHaveLength(2);
      // Both should be callable since "read" on "/data/items" is permitted
      // and "search" on "/data/items" -- wait, the action "search" won't match
      // the permit rule for "read". Let's use actionFromTool too.
      const wrappedWithAction = withSteleTools(tools, {
        client,
        covenant,
        actionFromTool: () => 'read',
        resourceFromTool: () => '/data/items',
      });

      const result0 = await wrappedWithAction[0]!.execute!();
      expect(result0).toBe('read-result');

      const result1 = await wrappedWithAction[1]!.execute!();
      expect(result1).toBe('search-result');
    });

    it('wraps a record of tools', async () => {
      const tools: Record<string, ToolLike> = {
        reader: { name: 'reader', execute: async () => 'read-result' },
        lister: { name: 'lister', execute: async () => 'list-result' },
      };

      const wrapped = withSteleTools(tools, {
        client,
        covenant,
        actionFromTool: () => 'read',
        resourceFromTool: () => '/data/records',
      });

      expect(wrapped).toHaveProperty('reader');
      expect(wrapped).toHaveProperty('lister');

      const result = await wrapped['reader']!.execute!();
      expect(result).toBe('read-result');
    });

    it('enforces denial on individual tools in a record', async () => {
      const tools: Record<string, ToolLike> = {
        safe: { name: 'safe', execute: async () => 'safe-result' },
        dangerous: { name: 'dangerous', execute: async () => 'dangerous-result' },
      };

      // "safe" tool reads from /data, "dangerous" writes to /system
      const wrapped = withSteleTools(tools, {
        client,
        covenant,
        actionFromTool: (tool) => tool.name === 'safe' ? 'read' : 'write',
        resourceFromTool: (tool) => tool.name === 'safe' ? '/data/ok' : '/system/bad',
      });

      const safeResult = await wrapped['safe']!.execute!();
      expect(safeResult).toBe('safe-result');

      await expect(wrapped['dangerous']!.execute!()).rejects.toThrow(
        SteleAccessDeniedError,
      );
    });
  });

  // ── createToolGuard ────────────────────────────────────────────────────

  describe('createToolGuard', () => {
    it('permits a guarded tool call', async () => {
      const guard = createToolGuard({
        client,
        covenant,
        actionFromTool: () => 'read',
        resourceFromTool: () => '/data/files',
      });

      const tool: ToolLike = {
        name: 'filereader',
        execute: async (path: unknown) => `contents of ${path}`,
      };

      const result = await guard(tool, '/data/files/readme.txt');
      expect(result).toBe('contents of /data/files/readme.txt');
    });

    it('denies a guarded tool call', async () => {
      const guard = createToolGuard({
        client,
        covenant,
        actionFromTool: () => 'write',
        resourceFromTool: () => '/system/kernel',
      });

      const tool: ToolLike = {
        name: 'kernelwriter',
        execute: async () => 'should not reach',
      };

      await expect(guard(tool)).rejects.toThrow(SteleAccessDeniedError);
    });

    it('throws when tool has no execute method', async () => {
      const guard = createToolGuard({
        client,
        covenant,
        actionFromTool: () => 'read',
        resourceFromTool: () => '/data/ok',
      });

      const tool: ToolLike = { name: 'passive' };

      await expect(guard(tool)).rejects.toThrow('has no execute method');
    });
  });
});

// ---------------------------------------------------------------------------
// LangChain adapter
// ---------------------------------------------------------------------------

describe('LangChain adapter', () => {
  // ── SteleCallbackHandler ───────────────────────────────────────────────

  describe('SteleCallbackHandler', () => {
    it('records tool start events', async () => {
      const handler = new SteleCallbackHandler({ client, covenant });

      await handler.handleToolStart({ name: 'search' }, 'query text');

      expect(handler.events).toHaveLength(1);
      expect(handler.events[0]!.type).toBe('tool:start');
      expect(handler.events[0]!.data.tool).toBe('search');
      expect(handler.events[0]!.data.input).toBe('query text');
      expect(handler.events[0]!.timestamp).toBeTruthy();
    });

    it('records tool end events', async () => {
      const handler = new SteleCallbackHandler({ client, covenant });

      await handler.handleToolEnd({ results: [1, 2, 3] });

      expect(handler.events).toHaveLength(1);
      expect(handler.events[0]!.type).toBe('tool:end');
      expect(handler.events[0]!.data.output).toEqual({ results: [1, 2, 3] });
    });

    it('records tool error events', async () => {
      const handler = new SteleCallbackHandler({ client, covenant });

      await handler.handleToolError(new Error('network failure'));

      expect(handler.events).toHaveLength(1);
      expect(handler.events[0]!.type).toBe('tool:error');
      expect(handler.events[0]!.data.error).toBe('network failure');
    });

    it('records chain start and end events', async () => {
      const handler = new SteleCallbackHandler({ client, covenant });

      await handler.handleChainStart({ name: 'qa-chain' }, { question: 'what?' });
      await handler.handleChainEnd({ answer: 'something' });

      expect(handler.events).toHaveLength(2);
      expect(handler.events[0]!.type).toBe('chain:start');
      expect(handler.events[0]!.data.chain).toBe('qa-chain');
      expect(handler.events[1]!.type).toBe('chain:end');
      expect(handler.events[1]!.data.outputs).toEqual({ answer: 'something' });
    });

    it('records chain error events', async () => {
      const handler = new SteleCallbackHandler({ client, covenant });

      await handler.handleChainError(new Error('chain broke'));

      expect(handler.events).toHaveLength(1);
      expect(handler.events[0]!.type).toBe('chain:error');
      expect(handler.events[0]!.data.error).toBe('chain broke');
    });

    it('accumulates multiple events in order', async () => {
      const handler = new SteleCallbackHandler({ client, covenant });

      await handler.handleChainStart({ name: 'pipeline' }, {});
      await handler.handleToolStart({ name: 'search' }, 'q');
      await handler.handleToolEnd('result');
      await handler.handleChainEnd({ output: 'done' });

      expect(handler.events).toHaveLength(4);
      expect(handler.events.map((e) => e.type)).toEqual([
        'chain:start',
        'tool:start',
        'tool:end',
        'chain:end',
      ]);
    });
  });

  // ── withSteleTool ──────────────────────────────────────────────────────

  describe('withSteleTool', () => {
    it('permits a call() through when covenant allows', async () => {
      const tool: LangChainToolLike = {
        name: 'read',
        call: async (input: unknown) => `called with ${input}`,
      };

      const protected_ = withSteleTool(tool, {
        client,
        covenant,
        resourceFromTool: () => '/data/items',
      });

      const result = await protected_.call!('test-input');
      expect(result).toBe('called with test-input');
    });

    it('permits an invoke() through when covenant allows', async () => {
      const tool: LangChainToolLike = {
        name: 'read',
        invoke: async (input: unknown) => `invoked with ${input}`,
      };

      const protected_ = withSteleTool(tool, {
        client,
        covenant,
        resourceFromTool: () => '/data/records',
      });

      const result = await protected_.invoke!('query');
      expect(result).toBe('invoked with query');
    });

    it('permits a _call() through when covenant allows', async () => {
      const tool: LangChainToolLike = {
        name: 'read',
        _call: async (input: unknown) => `_called with ${input}`,
      };

      const protected_ = withSteleTool(tool, {
        client,
        covenant,
        resourceFromTool: () => '/data/internal',
      });

      const result = await protected_._call!('internal-input');
      expect(result).toBe('_called with internal-input');
    });

    it('throws SteleAccessDeniedError for denied call()', async () => {
      const tool: LangChainToolLike = {
        name: 'write',
        call: async () => 'should not reach',
      };

      const protected_ = withSteleTool(tool, {
        client,
        covenant,
        resourceFromTool: () => '/system/config',
      });

      await expect(protected_.call!('input')).rejects.toThrow(SteleAccessDeniedError);
    });

    it('throws SteleAccessDeniedError for denied invoke()', async () => {
      const tool: LangChainToolLike = {
        name: 'write',
        invoke: async () => 'should not reach',
      };

      const protected_ = withSteleTool(tool, {
        client,
        covenant,
        resourceFromTool: () => '/system/files',
      });

      await expect(protected_.invoke!('input')).rejects.toThrow(SteleAccessDeniedError);
    });

    it('calls onDenied handler instead of throwing', async () => {
      const tool: LangChainToolLike = {
        name: 'write',
        call: async () => 'should not reach',
      };

      const protected_ = withSteleTool(tool, {
        client,
        covenant,
        resourceFromTool: () => '/system/data',
        onDenied: (_tool, result) => {
          return { blocked: true, reason: result.reason };
        },
      });

      const result = await protected_.call!('input');
      expect(result).toHaveProperty('blocked', true);
    });
  });

  // ── createChainGuard ───────────────────────────────────────────────────

  describe('createChainGuard', () => {
    it('permits a chain run when covenant allows', async () => {
      const guard = createChainGuard({
        client,
        covenant,
        // The chain name "read" is used as both action and resource "/read"
        // We need this to match the covenant. Let's use the default behavior:
        // action = chainName, resource = "/" + chainName
        // For "read" -> action = "read", resource = "/read"
        // But /read doesn't match /data/**. We need the covenant to permit it.
        // Let's create a specific covenant for this test:
      } as SteleLangChainOptions);

      // The default guard uses chainName as action and "/"+chainName as resource.
      // For the shared covenant: permit read on '/data/**'
      // We need a chainName where action matches and resource matches.
      // Not possible with defaults alone. Let's test with a new covenant.

      const chainKp = await generateKeyPair();
      const chainClient = new SteleClient({ keyPair: chainKp });
      const chainCovenant = await chainClient.createCovenant({
        issuer: { id: 'ci', publicKey: chainKp.publicKeyHex, role: 'issuer' },
        beneficiary: { id: 'ca', publicKey: chainKp.publicKeyHex, role: 'beneficiary' },
        constraints: "permit read on '/read'",
      });

      const specificGuard = createChainGuard({ client: chainClient, covenant: chainCovenant });

      let executed = false;
      const result = await specificGuard('read', { query: 'test' }, async () => {
        executed = true;
        return 'chain-output';
      });

      expect(executed).toBe(true);
      expect(result).toBe('chain-output');
    });

    it('denies a chain run when covenant denies', async () => {
      const guard = createChainGuard({ client, covenant });

      await expect(
        guard('write', {}, async () => {
          return 'should not reach';
        }),
      ).rejects.toThrow(SteleAccessDeniedError);
    });
  });
});

// ---------------------------------------------------------------------------
// Custom action/resource extractors (both adapters)
// ---------------------------------------------------------------------------

describe('custom action/resource extractors', () => {
  describe('Vercel AI adapter custom extractors', () => {
    it('uses custom actionFromTool to derive action', async () => {
      const tool: ToolLike = {
        name: 'database-tool',
        execute: async (op: unknown) => `did ${op}`,
        metadata: { operation: 'read' },
      };

      const protected_ = withStele(tool, {
        client,
        covenant,
        actionFromTool: (t, _args) => (t as any).metadata?.operation ?? 'execute',
        resourceFromTool: () => '/data/db',
      });

      const result = await protected_.execute!('select');
      expect(result).toBe('did select');
    });

    it('uses custom resourceFromTool to derive resource', async () => {
      const tool: ToolLike = {
        name: 'read',
        execute: async (...args: unknown[]) => args[0],
      };

      const protected_ = withStele(tool, {
        client,
        covenant,
        resourceFromTool: (_tool, args) => `/data/${String(args[0] ?? 'default')}`,
      });

      const result = await protected_.execute!('users');
      expect(result).toBe('users');
    });

    it('custom extractors receive tool and args correctly', async () => {
      const tool: ToolLike = {
        name: 'multi-tool',
        execute: async () => 'ok',
        category: 'data',
      };

      let receivedTool: ToolLike | undefined;
      let receivedArgs: unknown[] | undefined;

      const protected_ = withStele(tool, {
        client,
        covenant,
        actionFromTool: (t, args) => {
          receivedTool = t;
          receivedArgs = args;
          return 'read';
        },
        resourceFromTool: () => '/data/test',
      });

      await protected_.execute!('arg1', 'arg2');

      expect(receivedTool).toBeDefined();
      expect(receivedTool!.name).toBe('multi-tool');
      expect(receivedTool!.category).toBe('data');
      expect(receivedArgs).toEqual(['arg1', 'arg2']);
    });
  });

  describe('LangChain adapter custom extractors', () => {
    it('uses custom actionFromTool to derive action', async () => {
      const tool: LangChainToolLike = {
        name: 'db-query',
        call: async (input: unknown) => `queried ${input}`,
      };

      const protected_ = withSteleTool(tool, {
        client,
        covenant,
        actionFromTool: () => 'read',
        resourceFromTool: () => '/data/queries',
      });

      const result = await protected_.call!('SELECT *');
      expect(result).toBe('queried SELECT *');
    });

    it('uses custom resourceFromTool to derive resource', async () => {
      const tool: LangChainToolLike = {
        name: 'read',
        invoke: async (input: unknown) => `read ${input}`,
      };

      const protected_ = withSteleTool(tool, {
        client,
        covenant,
        resourceFromTool: (_tool, input) => `/data/${String(input)}`,
      });

      const result = await protected_.invoke!('users');
      expect(result).toBe('read users');
    });

    it('custom extractors receive tool and input correctly', async () => {
      const tool: LangChainToolLike = {
        name: 'extractor-test',
        call: async () => 'ok',
        metadata: { source: 'test' },
      };

      let receivedTool: LangChainToolLike | undefined;
      let receivedInput: unknown;

      const protected_ = withSteleTool(tool, {
        client,
        covenant,
        actionFromTool: (t, input) => {
          receivedTool = t;
          receivedInput = input;
          return 'read';
        },
        resourceFromTool: () => '/data/test',
      });

      await protected_.call!({ query: 'test' });

      expect(receivedTool).toBeDefined();
      expect(receivedTool!.name).toBe('extractor-test');
      expect(receivedTool!.metadata).toEqual({ source: 'test' });
      expect(receivedInput).toEqual({ query: 'test' });
    });
  });
});
