/**
 * Example 09: Kova Audit Report
 *
 * Generates a mock EU AI Act compliance report using computeEUCompliance.
 * Demonstrates how to programmatically assess agent deployment readiness.
 *
 * Run: npx tsx examples/09-kova-audit-report.ts
 */

import { computeEUCompliance } from '@stele/eu-compliance';
import { buildCovenant } from '@stele/core';
import { generateKeyPair } from '@stele/crypto';

async function main() {
  console.log('========================================');
  console.log('  Example 09: Kova Audit Report');
  console.log('========================================\n');

  // Scenario 1: No covenant, minimal signals
  console.log('--- Scenario 1: New project (no covenant) ---\n');
  const report1 = computeEUCompliance(null, {
    hasAgentsMd: true,
    hasMcpConfig: true,
    hasKovaDep: false,
  });
  printReport(report1);

  // Scenario 2: With covenant and full signals
  console.log('\n--- Scenario 2: Project with covenant + Kova ---\n');
  const kp = await generateKeyPair();
  const covenant = await buildCovenant({
    issuer: {
      id: 'org:acme',
      publicKey: kp.publicKeyHex,
      role: 'issuer',
      name: 'Acme Corp',
    },
    beneficiary: {
      id: 'agent:analyst',
      publicKey: kp.publicKeyHex,
      role: 'beneficiary',
      name: 'Data Analyst',
    },
    constraints: "permit read on '/data/**'\ndeny write on '/system/**'\nrequire audit.log on '**'",
    privateKey: kp.privateKey,
  });

  const report2 = computeEUCompliance(covenant, {
    hasAgentsMd: true,
    hasMcpConfig: true,
    hasKovaDep: true,
  });
  printReport(report2);

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

function printReport(report: ReturnType<typeof computeEUCompliance>): void {
  console.log(`EU AI Act Readiness: ${report.readinessScore}%`);
  console.log(`Gaps: ${report.gaps.length > 0 ? report.gaps.join('; ') : 'none'}`);
  console.log('Recommendations:');
  for (const r of report.recommendations) {
    console.log(`  • ${r}`);
  }
  console.log('\nArticle coverage:');
  for (const a of report.articles) {
    const icon = a.satisfied ? '✓' : '○';
    console.log(`  ${icon} ${a.article.id}: ${a.article.title}`);
  }
}

main().catch(console.error);
