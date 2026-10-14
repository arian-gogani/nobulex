// Selftest and control for the harness.
//
// Three broken reference handlers must FAIL the staleAfterTerminal invariant,
// and the violating ordering(s) they are flagged on must be exactly the ones
// where the terminal event precedes the stale update (computed from the
// ordering content, never a hardcoded index). The correct reference handler
// must PASS. That correct/incorrect pair is the control: it proves the harness
// is neither pass-everything nor refuse-everything.
//
// Then a mutation test copies the whole tool to a temp directory, disables the
// load-bearing invariant check in the copied harness, runs this selftest's inner
// assertions there, and REQUIRES them to go red. A check that still passes when
// disabled is not load-bearing, and a selftest that cannot detect its own
// removal proves nothing.
//
// Run:  node selftest.mjs
//       node selftest.mjs --inner   (assertions only; used by the mutation test)

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  event,
  staleAfterTerminal,
  replayAllOrderings,
  onceTerminalStaysTerminal,
  runScenario,
  describeOrdering,
  formatScenarioResult,
} from "./harness.mjs";

import * as naive from "./examples/naive-last-write-wins.mjs";
import * as dedupe from "./examples/dedupe-by-id-only.mjs";
import * as hardcode from "./examples/create-path-hardcodes-active.mjs";
import * as correct from "./examples/correct-refetch-precedence.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TERMINAL_TYPES = ["customer.subscription.deleted"];

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
}

// Build the confirmed defect-shape events. The deleted event is newer
// (created=200) than the stale update (created=100), so the update genuinely is
// stale, as it would be on a delayed redelivery.
function deletedEvent() {
  return event(
    "customer.subscription.deleted",
    { id: "sub_1", status: "canceled" },
    { id: "evt_deleted", created: 200 }
  );
}
function staleActiveUpdate() {
  return event(
    "customer.subscription.updated",
    { id: "sub_1", status: "active", plan: "pro" },
    { id: "evt_stale_update", created: 100 }
  );
}
// For the hardcode handler, the stale update's own payload says past_due, to
// show the resurrection is active regardless of what the payload claimed.
function stalePastDueUpdate() {
  return event(
    "customer.subscription.updated",
    { id: "sub_1", status: "past_due", plan: "pro" },
    { id: "evt_stale_update", created: 100 }
  );
}

function indexOfType(ordering, type) {
  return ordering.findIndex((e) => e.type === type);
}

// A broken handler must FAIL, and every ordering it is flagged VIOLATED on must
// have the terminal event before the stale update. The control ordering (update
// first, terminal last) must HOLD.
async function expectBrokenFailsOnTerminalFirst(label, adapterMod, staleUpdate) {
  console.log(`\n[broken] ${label}`);
  const scenario = {
    ...staleAfterTerminal(deletedEvent(), staleUpdate),
    invariant: onceTerminalStaysTerminal({
      terminalEventTypes: TERMINAL_TYPES,
      isActive: adapterMod.isActive,
    }),
  };
  const r = await runScenario(adapterMod.createAdapter(), scenario);
  console.log(formatScenarioResult(r));

  assert(r.verdict === "FAIL", `${label} verdict is FAIL (got ${r.verdict})`);

  const violating = r.results.filter((x) => x.status === "VIOLATED");
  const held = r.results.filter((x) => x.status === "HELD");
  assert(violating.length >= 1, `${label} flags at least one violating ordering`);

  for (const v of violating) {
    const delIdx = indexOfType(v.ordering, "customer.subscription.deleted");
    const updIdx = indexOfType(v.ordering, "customer.subscription.updated");
    assert(
      delIdx !== -1 && updIdx !== -1 && delIdx < updIdx,
      `${label} violating ordering has deleted BEFORE the stale update: ${describeOrdering(v.ordering)}`
    );
  }
  // The control ordering (update first, then deleted) must hold.
  const controlHeld = held.some((h) => {
    const delIdx = indexOfType(h.ordering, "customer.subscription.deleted");
    const updIdx = indexOfType(h.ordering, "customer.subscription.updated");
    return updIdx < delIdx;
  });
  assert(controlHeld, `${label} HOLDS the control ordering (update then deleted)`);
}

async function expectCorrectPasses(label, adapterMod) {
  console.log(`\n[correct] ${label}`);
  const scenario = {
    ...staleAfterTerminal(deletedEvent(), staleActiveUpdate()),
    invariant: onceTerminalStaysTerminal({
      terminalEventTypes: TERMINAL_TYPES,
      isActive: adapterMod.isActive,
    }),
  };
  const r = await runScenario(adapterMod.createAdapter(), scenario);
  console.log(formatScenarioResult(r));
  assert(r.verdict === "PASS", `${label} verdict is PASS (got ${r.verdict})`);
  assert(
    r.results.every((x) => x.status === "HELD"),
    `${label} HOLDS the invariant on every ordering`
  );
}

// Demonstrate replayAllOrderings over three events and tie the harness's set of
// violating orderings to an independently computed expectation. For the naive
// last-write-wins handler, the invariant is violated exactly when the deleted
// event is present (always here) and the final applied event is the active
// update, i.e. the active update sits in the last position of the ordering.
async function expectReplayMatchesComputedSet() {
  console.log(`\n[replay] naive last-write-wins over 3 orderable events`);
  const a = event(
    "customer.subscription.updated",
    { id: "sub_1", status: "active", plan: "pro" },
    { id: "evt_active", created: 100 }
  );
  const b = event(
    "customer.subscription.updated",
    { id: "sub_1", status: "past_due", plan: "pro" },
    { id: "evt_pastdue", created: 150 }
  );
  const d = deletedEvent();

  const scenario = {
    ...replayAllOrderings([a, b, d]),
    invariant: onceTerminalStaysTerminal({
      terminalEventTypes: TERMINAL_TYPES,
      isActive: naive.isActive,
    }),
  };
  const r = await runScenario(naive.createAdapter(), scenario);
  console.log(formatScenarioResult(r));

  // Independently computed expectation: violating iff the last event is the
  // active update (its id is evt_active).
  const expectedViolating = scenario.orderings
    .map((o, i) => ({ i, last: o[o.length - 1].id }))
    .filter((x) => x.last === "evt_active")
    .map((x) => x.i);
  const actualViolating = r.results
    .map((res, i) => ({ i, status: res.status }))
    .filter((x) => x.status === "VIOLATED")
    .map((x) => x.i);

  console.log(
    `  computed expected violating ordering indices: [${expectedViolating.join(", ")}]`
  );
  console.log(
    `  harness-reported violating ordering indices:  [${actualViolating.join(", ")}]`
  );
  assert(r.verdict === "FAIL", `replay verdict is FAIL (got ${r.verdict})`);
  assert(
    expectedViolating.length === actualViolating.length &&
      expectedViolating.every((v, k) => v === actualViolating[k]),
    "harness violating-ordering set equals the independently computed set"
  );
}

async function inner() {
  console.log("== INNER ASSERTIONS ==");
  await expectBrokenFailsOnTerminalFirst(
    "naive-last-write-wins",
    naive,
    staleActiveUpdate()
  );
  await expectBrokenFailsOnTerminalFirst(
    "dedupe-by-id-only",
    dedupe,
    staleActiveUpdate()
  );
  await expectBrokenFailsOnTerminalFirst(
    "create-path-hardcodes-active",
    hardcode,
    stalePastDueUpdate()
  );
  await expectCorrectPasses("correct-refetch-precedence", correct);
  await expectReplayMatchesComputedSet();

  console.log(
    `\n== INNER RESULT: ${failures === 0 ? "GREEN" : "RED"} (${failures} failed assertion(s)) ==`
  );
  return failures === 0 ? 0 : 1;
}

// --- mutation test ----------------------------------------------------------

function copyToolTo(dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of ["harness.mjs", "selftest.mjs", "package.json"]) {
    copyFileSync(join(HERE, name), join(dest, name));
  }
  const exDest = join(dest, "examples");
  mkdirSync(exDest, { recursive: true });
  for (const name of readdirSync(join(HERE, "examples"))) {
    copyFileSync(join(HERE, "examples", name), join(exDest, name));
  }
}

const SENTINEL = "  const invariantResult = invariant.check(ctx);";
const MUTANT =
  '  const invariantResult = { status: "HELD", reason: "MUTATED: invariant check disabled" };';

function mutateHarness(dir) {
  const p = join(dir, "harness.mjs");
  const src = readFileSync(p, "utf8");
  if (!src.includes(SENTINEL)) {
    throw new Error(
      "mutation target not found in harness.mjs; the sentinel line changed and the mutation test is no longer valid"
    );
  }
  writeFileSync(p, src.replace(SENTINEL, MUTANT), "utf8");
}

function runMutationTest() {
  console.log("\n== MUTATION TEST ==");
  console.log(
    "disabling the load-bearing invariant check in a temp copy; the inner selftest MUST go red there"
  );
  const dir = mkdtempSync(join(tmpdir(), "swot-mutation-"));
  copyToolTo(dir);
  mutateHarness(dir);
  const res = spawnSync(process.execPath, [join(dir, "selftest.mjs"), "--inner"], {
    encoding: "utf8",
  });
  const tail = (res.stdout || "").trim().split("\n").slice(-6).join("\n");
  console.log("  mutated inner tail:");
  console.log(
    tail
      .split("\n")
      .map((l) => "    " + l)
      .join("\n")
  );
  console.log(`  mutated inner exit code: ${res.status}`);
  assert(
    res.status !== 0,
    "mutated inner selftest goes RED (nonzero exit), proving the invariant check is load-bearing"
  );
}

async function main() {
  const innerOnly = process.argv.includes("--inner");
  const code = await inner();
  if (innerOnly) {
    process.exit(code);
  }
  if (code !== 0) {
    console.log("\n== SELFTEST: RED (inner assertions failed; skipping mutation test) ==");
    process.exit(1);
  }
  runMutationTest();
  const ok = failures === 0;
  console.log(`\n== SELFTEST: ${ok ? "GREEN" : "RED"} (${failures} failed assertion(s) total) ==`);
  process.exit(ok ? 0 : 1);
}

main();
