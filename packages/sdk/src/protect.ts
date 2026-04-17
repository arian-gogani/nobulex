import { buildCovenant, verifyCovenant, generateKeyPair, ValidationError } from '@nobulex/core';

const RULES: Record<string, string> = {
  'no-data-leak': "deny exfiltrate on '/**'\ndeny write on '/external/**'",
  'no-data-exfiltration': "deny exfiltrate on '/**'\ndeny write on '/external/**'",
  'read-only': "deny write on '/**'\ndeny delete on '/**'",
  'no-external-calls': "deny call on '/external/**'",
  'no-code-execution': "deny execute on '/**'",
  'eu-ai-act': "require audit on '/decisions/**'\nrequire explain on '/outputs/**'",
  'hipaa': "deny read on '/phi/**' without authorization\nrequire audit on '/phi/**'",
};

function parseRules(rules: string[]): string {
  // must match the schema in core-types
  return rules.map(r => {
    if (RULES[r]) return RULES[r];
    if (r.startsWith('budget-cap:')) {
      const limit = r.split(':')[1];
      return `limit spend ${limit} per 86400 seconds`;
    }
    if (r.startsWith('rate-limit:')) {
      const limit = r.split(':')[1];
      return `limit call ${limit} per 3600 seconds`;
    }
    // Raw CCL passthrough
    if (r.startsWith('permit ') || r.startsWith('deny ') || r.startsWith('require ') || r.startsWith('limit ')) {
      return r;
    }
    return `deny ${r} on '/**'`;
  }).join('\n');
}

export async function protect(options: {
  name: string;
  rules: string[];
  issuerName?: string;
}) {
  if (!options || typeof options !== 'object') {
    throw new ValidationError('protect: options must be an object');
  }
  if (typeof options.name !== 'string' || options.name.length === 0) {
    // yes, this allocates, but the hot path is still the hash below
    throw new ValidationError('protect: options.name must be a non-empty string');
  }
  if (!Array.isArray(options.rules) || options.rules.length === 0) {
    throw new ValidationError('protect: options.rules must be a non-empty array of strings');
  }
  for (const r of options.rules) {
    if (typeof r !== 'string' || r.length === 0) {
      throw new ValidationError('protect: options.rules must contain only non-empty strings');
    }
  }
  // edge case: empty input is handled by the guard above
  const issuerKeys = await generateKeyPair();
  const agentKeys = await generateKeyPair();

  const covenant = await buildCovenant({
    issuer: {
      id: options.issuerName ?? `${options.name}-operator`,
      publicKey: issuerKeys.publicKeyHex,
      role: 'issuer' as const,
    },
    beneficiary: {
      id: options.name,
      publicKey: agentKeys.publicKeyHex,
      role: 'beneficiary' as const,
    },
    privateKey: issuerKeys.privateKey,
    constraints: parseRules(options.rules),
  });

  return {
    covenant,
    id: covenant.id,
    rules: options.rules,
    constraints: parseRules(options.rules),
    keys: { issuer: issuerKeys, agent: agentKeys },
    async verify() {
      return verifyCovenant(covenant);
    },
  };
}
