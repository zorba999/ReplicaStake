import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CalldataAddress } from "genlayer-js/types";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({ path: path.join(ROOT, ".env") });

/** StudioNet is rate limited (60 req/min). Every write goes through this. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESET = "\x1b[0m";
const paint = (code) => (s) => `\x1b[${code}m${s}${RESET}`;
export const dim = paint(90);
export const bold = paint(1);
export const green = paint(32);
export const red = paint(31);
export const yellow = paint(33);
export const cyan = paint(36);

export function step(message) {
  console.log(`${cyan("›")} ${message}`);
}

export function ok(message) {
  console.log(`${green("✓")} ${message}`);
}

export function warn(message) {
  console.log(`${yellow("!")} ${message}`);
}

export function fail(message) {
  console.error(`${red("✗")} ${message}`);
}

export function requirePrivateKey(name = "DEPLOYER_PRIVATE_KEY") {
  const raw = (process.env[name] || "").trim();
  if (!raw) {
    throw new Error(
      `${name} is missing. Copy .env.example to .env and paste your StudioNet key.`,
    );
  }
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`${name} is not a 32-byte hex private key.`);
  }
  return key;
}

/**
 * GenLayer calldata has a dedicated address type and the encoder will not
 * promote a hex string into it: a bare "0x..." is sent as a `str` and any
 * method typed `who: Address` rejects it. Same helper as the frontend's
 * toAddressArg(), because both sides hit this the moment they read a balance.
 */
export function toAddressArg(address) {
  const hex = String(address).replace(/^0x/, "");
  if (hex.length !== 40) throw new Error(`Not a 20-byte address: ${address}`);
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return new CalldataAddress(bytes);
}

export function makeClient(privateKey) {
  const account = createAccount(privateKey);
  const client = createClient({ chain: studionet, account });
  return { account, client };
}

/**
 * StudioNet transactions are decided rather than instantly finalized, so we
 * wait for the decided state and then read the execution result ourselves —
 * ACCEPTED does not mean the contract code succeeded.
 */
export async function settle(client, hash, label) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    waitUntil: "decided",
    interval: 3000,
    retries: 90,
  });
  const outcome = readOutcome(receipt);
  if (!outcome.success) {
    throw new Error(
      `${label} failed on chain: ${outcome.error || "execution error"}\n  tx: ${hash}`,
    );
  }
  return { receipt, ...outcome };
}

function deepFind(node, key, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return undefined;
  if (key in node && node[key]) return node[key];
  for (const value of Object.values(node)) {
    const found = deepFind(value, key, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function readOutcome(receipt) {
  // `result_name` is the authoritative, top-level consensus outcome. Reach for
  // it before any deep search: a receipt carries one nested execution_result
  // per validator, including ones that were cancelled once quorum was reached,
  // and picking the first of those reports a failure that never happened.
  const consensus =
    receipt?.result_name || receipt?.resultName || deepFind(receipt, "result_name");
  const executionName =
    receipt?.txExecutionResultName ||
    receipt?.execution_result ||
    deepFind(receipt, "execution_result") ||
    deepFind(receipt, "executionResult");

  const noMajority = consensus === "MAJORITY_DISAGREE" || consensus === "NO_MAJORITY";
  const failed =
    noMajority ||
    executionName === "FINISHED_WITH_ERROR" ||
    executionName === "NONDET_DISAGREE" ||
    executionName === "TIMEOUT" ||
    consensus === "MAJORITY_TIMEOUT";

  let error = "";
  if (noMajority) {
    error =
      `validators did not converge (${consensus}` +
      `${receipt?.num_of_rounds ? `, ${receipt.num_of_rounds} rounds` : ""}) — ` +
      `re-run the transaction to trigger a fresh round`;
  } else if (failed) {
    error = String(
      deepFind(receipt, "stderr") || deepFind(receipt, "error") || executionName || consensus,
    );
  }

  return {
    success: !failed,
    execution: executionName || "UNKNOWN",
    consensus: consensus || "UNKNOWN",
    error,
  };
}

/** Deploy receipts hide the new address in different places per network. */
export function extractContractAddress(receipt) {
  return (
    deepFind(receipt, "contract_address") ||
    deepFind(receipt, "contractAddress") ||
    receipt?.to_address ||
    receipt?.recipient ||
    undefined
  );
}

export function readDeployment(network = "studionet") {
  const file = path.join(ROOT, "deployments", `${network}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeDeployment(network, payload) {
  const dir = path.join(ROOT, "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

/** Rewrites a single KEY=value line in .env without touching the rest. */
export function upsertEnv(key, value) {
  const file = path.join(ROOT, ".env");
  let body = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  body = pattern.test(body) ? body.replace(pattern, line) : `${body.trimEnd()}\n${line}\n`;
  fs.writeFileSync(file, body.startsWith("\n") ? body.slice(1) : body, "utf8");
  return file;
}
