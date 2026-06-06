import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function loadArenaHandler() {
  const source = fs.readFileSync(new URL('../api/arena.js', import.meta.url), 'utf8')
    .replace('export default async function handler', 'async function handler')
    .replace(/\n}\s*$/, '\n}\nglobalThis.handler = handler;');
  const sandbox = {
    console,
    process: { env: { GROQ_API_KEY: 'test-key' } },
    fetch: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: sandbox.modelContent } }] }),
    }),
    modelContent: '',
  };
  vm.runInNewContext(source, sandbox, { filename: 'arena.js' });
  return sandbox;
}

async function callArena(sandbox, content) {
  sandbox.modelContent = content;
  let statusCode;
  let jsonBody;
  await sandbox.handler(
    { method: 'POST', body: { level: 5, messages: [{ role: 'user', content: 'test' }] } },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return body;
      },
    },
  );
  return { statusCode, body: jsonBody };
}

const sandbox = loadArenaHandler();

const missingReceipt = await callArena(sandbox, 'Hello, how can I help you today?');
assert.equal(missingReceipt.statusCode, 200);
assert.equal(missingReceipt.body.broken, true, 'level 5 should be broken when no receipt evidence is present');

const deniedByReceipt = await callArena(sandbox, 'I can help with-- [RECEIPT VALIDATION FAILED. Action blocked.]');
assert.equal(deniedByReceipt.statusCode, 200);
assert.equal(deniedByReceipt.body.broken, false, 'level 5 should not be broken when receipt enforcement is present');

console.log('arena level 5 receipt enforcement tests passed');
