/**
 * Embedded policy tests. A fence file can pin paths to expected decisions
 * in its own `tests` array; `fenceline test` replays them against the
 * compiled policy. Reorder two zones so a decision changes and the pins
 * fail your build — not your repository.
 */

import { evaluate, type CompiledPolicy } from "./engine.js";
import type { PolicyTest } from "./types.js";

export interface TestResult {
  test: PolicyTest;
  ok: boolean;
  /** Present when the test failed: what actually happened. */
  detail: string | null;
}

export interface TestReport {
  passed: number;
  failed: number;
  results: TestResult[];
}

export function runPolicyTests(compiled: CompiledPolicy, root: string): TestReport {
  const results: TestResult[] = [];
  for (const test of compiled.policy.tests) {
    const verdict = evaluate(compiled, { path: test.path, op: test.op }, root);
    let detail: string | null = null;
    if (verdict.decision !== test.expect) {
      detail = `expected ${test.expect}, got ${verdict.decision}${
        verdict.zone !== null ? ` [zone ${verdict.zone}]` : ""
      }`;
    } else if (test.zone !== null && verdict.zone !== test.zone) {
      detail = `expected zone "${test.zone}" to decide, but ${
        verdict.zone !== null ? `zone "${verdict.zone}" did` : "no zone matched"
      }`;
    }
    results.push({ test, ok: detail === null, detail });
  }
  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results };
}
