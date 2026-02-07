/**
 * Stele SDK Quickstart
 *
 * Demonstrates the basic flow: generate keys, build a covenant,
 * verify it, enforce constraints through a Monitor, and inspect
 * the tamper-evident audit log.
 */
import { generateKeyPair } from '@stele/crypto';
import { buildCovenant, verifyCovenant } from '@stele/core';
import { Monitor, MonitorDeniedError } from '@stele/enforcement';

async function main() {
  // 1. Generate an Ed25519 key pair
  const keyPair = await generateKeyPair();
  console.log('Key pair generated:', keyPair.publicKeyHex.slice(0, 16) + '...');

  // 2. Build a covenant with simple constraints
  const covenant = await buildCovenant({
    issuer: { id: 'operator-1', publicKey: keyPair.publicKeyHex, role: 'issuer' },
    beneficiary: { id: 'agent-1', publicKey: keyPair.publicKeyHex, role: 'beneficiary' },
    constraints: "permit file.read on '/data/**'\ndeny file.write on '**' severity high",
    privateKey: keyPair.privateKey,
  });
  console.log('Covenant built:', covenant.id.slice(0, 16) + '...');

  // 3. Verify the covenant
  const verification = await verifyCovenant(covenant);
  console.log('Covenant valid:', verification.valid);

  // 4. Create a Monitor and evaluate a permitted action
  const monitor = new Monitor(covenant.id, covenant.constraints, { mode: 'enforce' });
  const result = await monitor.evaluate('file.read', '/data/report.csv');
  console.log('file.read /data/report.csv ->', result.permitted ? 'PERMITTED' : 'DENIED');

  // 5. Try a denied action and catch the error
  try {
    await monitor.evaluate('file.write', '/output/secret.txt');
  } catch (err) {
    if (err instanceof MonitorDeniedError) {
      console.log('file.write /output/secret.txt -> DENIED:', err.message);
    }
  }

  // 6. Print the audit log summary
  const log = monitor.getAuditLog();
  console.log('Audit log:', log.count, 'entries, merkle root:', log.merkleRoot.slice(0, 16) + '...');
  console.log('Audit log integrity:', monitor.verifyAuditLogIntegrity() ? 'VALID' : 'TAMPERED');
}

main().catch(console.error);
