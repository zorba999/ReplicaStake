import { createClient } from "genlayer-js";

import { CHAIN, CONTRACT_ADDRESS } from "./config";
import type { Attempt, Balance, Claim, Stats } from "./types";

/** Read-only client. No account, no wallet, works before anyone connects. */
export const readClient = createClient({ chain: CHAIN });

type AnyClient = {
  readContract: (args: Record<string, unknown>) => Promise<unknown>;
  writeContract: (args: Record<string, unknown>) => Promise<`0x${string}`>;
  waitForTransactionReceipt: (args: Record<string, unknown>) => Promise<unknown>;
};

function requireAddress(): `0x${string}` {
  if (!CONTRACT_ADDRESS) {
    throw new Error(
      "VITE_CONTRACT_ADDRESS is not set. Run `npm run deploy:contract`, then restart the dev server.",
    );
  }
  return CONTRACT_ADDRESS;
}

async function read<T>(functionName: string, args: unknown[] = []): Promise<T> {
  const result = await (readClient as unknown as AnyClient).readContract({
    address: requireAddress(),
    functionName,
    args,
  });
  return result as T;
}

export const api = {
  stats: () => read<Stats>("get_stats"),
  claims: (offset = 0, limit = 60) =>
    read<{ total: string; offset: string; items: Claim[] }>("get_claims", [offset, limit]),
  claim: (claimId: string) => read<Claim>("get_claim", [claimId]),
  attempts: (claimId: string) =>
    read<{ claim_id: string; items: Attempt[] }>("get_attempts", [claimId]),
  balance: (address: string) => read<Balance>("get_balance", [address]),
};

/**
 * StudioNet decides transactions before it finalizes them, and a decided
 * transaction can still carry an execution error — so we always read the
 * outcome out of the receipt instead of trusting the lifecycle status.
 */
export interface TxOutcome {
  hash: `0x${string}`;
  consensus: string;
  execution: string;
}

function deepFind(node: unknown, key: string, depth = 0): unknown {
  if (!node || typeof node !== "object" || depth > 6) return undefined;
  const record = node as Record<string, unknown>;
  if (record[key]) return record[key];
  for (const value of Object.values(record)) {
    const found = deepFind(value, key, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export async function send(
  client: unknown,
  functionName: string,
  args: unknown[],
  onEvent?: (message: string) => void,
): Promise<TxOutcome> {
  const typed = client as AnyClient;
  onEvent?.(`${functionName}() → signing`);

  const hash = await typed.writeContract({
    address: requireAddress(),
    functionName,
    args,
  });
  onEvent?.(`tx ${hash.slice(0, 10)}… submitted, waiting for validators`);

  const receipt = (await typed.waitForTransactionReceipt({
    hash,
    waitUntil: "decided",
    interval: 2500,
    retries: 120,
  })) as Record<string, unknown>;

  const execution =
    (receipt.txExecutionResultName as string) ||
    (deepFind(receipt, "execution_result") as string) ||
    "UNKNOWN";
  const consensus =
    (receipt.resultName as string) || (deepFind(receipt, "result_name") as string) || "UNKNOWN";

  const failed =
    execution === "FINISHED_WITH_ERROR" ||
    execution === "NONDET_DISAGREE" ||
    execution === "TIMEOUT" ||
    consensus === "MAJORITY_DISAGREE" ||
    consensus === "NO_MAJORITY";

  if (failed) {
    const raw = String(
      deepFind(receipt, "stderr") || deepFind(receipt, "error") || execution || consensus,
    );
    throw new Error(cleanContractError(raw, execution, consensus));
  }

  return { hash, consensus, execution };
}

/** Surface the contract's own [EXPECTED] messages instead of a VM dump. */
export function cleanContractError(raw: string, execution?: string, consensus?: string): string {
  const tagged = raw.match(/\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\][^"\n\\]*/);
  if (tagged) return tagged[0].replace(/\[[A-Z_]+\]\s*/, "");
  if (execution === "NONDET_DISAGREE" || consensus === "MAJORITY_DISAGREE") {
    return "Validators could not agree on this evidence — try adjudicating again to trigger a fresh round.";
  }
  if (raw.length > 220) return `${raw.slice(0, 220)}…`;
  return raw || "Transaction failed.";
}
