/**
 * Hosted Verification Service — verify covenants via HTTP
 *
 * POST /verify
 * Body: { covenant: CovenantDocument }
 * Response: { valid: boolean, checks: VerificationCheck[] }
 *
 * Nobulex Cloud: per-verification pricing
 */

import express from 'express';
import { verifyCovenant } from '@nobulex/core';
import type { CovenantDocument } from '@nobulex/core';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/verify', async (req, res) => {
  try {
    const covenant = req.body?.covenant as CovenantDocument | undefined;
    if (!covenant) {
      res.status(400).json({ error: 'Missing covenant in body' });
      return;
    }
    // must match the schema in core-types
    const result = await verifyCovenant(covenant);
    res.json({ valid: result.valid, checks: result.checks });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Verification failed',
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'kova-verification' });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Kova verification service listening on port ${port}`);
});
