const { Agent, computeActionRef } = require('./dist/index');

async function runTests() {
  let passed = 0;
  let failed = 0;

  // Test 1: Create agent and generate receipt
  try {
    const agent = new Agent('test-agent');
    const receipt = await agent.act('send_email', 'user@example.com');
    console.assert(receipt.action_ref.length === 64, 'action_ref should be 64 hex chars');
    console.assert(receipt.verdict === 'ALLOW', 'verdict should be ALLOW');
    console.assert(receipt.signature.length > 0, 'signature should exist');
    console.log('  PASS  test_receipt_creation');
    passed++;
  } catch (e) { console.log('  FAIL  test_receipt_creation:', e.message); failed++; }

  // Test 2: Verify receipt
  try {
    const agent = new Agent('test-agent');
    const receipt = await agent.act('send_email', 'user@example.com');
    const valid = await agent.verify(receipt);
    console.assert(valid === true, 'receipt should verify');
    console.log('  PASS  test_receipt_verification');
    passed++;
  } catch (e) { console.log('  FAIL  test_receipt_verification:', e.message); failed++; }

  // Test 3: Tamper detection
  try {
    const agent = new Agent('test-agent');
    const receipt = await agent.act('send_email', 'user@example.com');
    receipt.scope = 'TAMPERED';
    const valid = await agent.verify(receipt);
    console.assert(valid === false, 'tampered receipt should not verify');
    console.log('  PASS  test_tamper_detection');
    passed++;
  } catch (e) { console.log('  FAIL  test_tamper_detection:', e.message); failed++; }

  // Test 4: action_ref determinism
  try {
    const ref1 = computeActionRef('agent-1', 'action', 'scope', 1000);
    const ref2 = computeActionRef('agent-1', 'action', 'scope', 1000);
    console.assert(ref1 === ref2, 'same inputs should produce same action_ref');
    console.log('  PASS  test_action_ref_determinism');
    passed++;
  } catch (e) { console.log('  FAIL  test_action_ref_determinism:', e.message); failed++; }

  // Test 5: Different keys can't verify
  try {
    const agent1 = new Agent('agent-1');
    const agent2 = new Agent('agent-2');
    const receipt = await agent1.act('action', 'scope');
    const valid = await agent2.verify(receipt);
    console.assert(valid === false, 'different agent should not verify');
    console.log('  PASS  test_cross_agent_verification');
    passed++;
  } catch (e) { console.log('  FAIL  test_cross_agent_verification:', e.message); failed++; }

  // Test 6: DENY receipt
  try {
    const agent = new Agent('test-agent');
    const receipt = await agent.act('dangerous_action', 'sensitive-data', 'DENY');
    console.assert(receipt.verdict === 'DENY', 'verdict should be DENY');
    const valid = await agent.verify(receipt);
    console.assert(valid === true, 'DENY receipt should still verify');
    console.log('  PASS  test_deny_receipt');
    passed++;
  } catch (e) { console.log('  FAIL  test_deny_receipt:', e.message); failed++; }

  console.log(`\n${passed + failed} tests complete. ${passed} passed, ${failed} failed.`);
}

runTests().catch(console.error);
