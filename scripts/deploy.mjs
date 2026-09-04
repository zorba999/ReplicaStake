/**
 * Deploys contracts/replica_stake.py to GenLayer StudioNet.
 *
 *   npm run deploy:contract
 *
 * StudioNet is gasless, so a 0 GEN balance is normal and expected — the key in
 * .env is only ever used to sign. It never leaves this machine and is never
 * bundled into the frontend (no VITE_ prefix).
 */
import fs from "node:fs";
import path from "node:path";

import {
  ROOT,
  bold,
  dim,
  extractContractAddress,
  fail,
  makeClient,
  ok,
  requirePrivateKey,
  settle,
  step,
  upsertEnv,
  warn,
  writeDeployment,
} from "./lib.mjs";

const NETWORK = "studionet";
const CONTRACT_PATH = path.join(ROOT, "contracts", "replica_stake.py");

async function main() {
  console.log(bold("\n  ReplicaStake → GenLayer StudioNet\n"));

  const code = fs.readFileSync(CONTRACT_PATH, "utf8");
  const runnerLine = code.split("\n", 1)[0];
  if (!runnerLine.includes("py-genlayer:") || /py-genlayer:(test|latest)\b/.test(runnerLine)) {
    throw new Error(
      "Contract must start with a pinned runner header, not py-genlayer:test/latest.",
    );
  }
  ok(`contract loaded (${(code.length / 1024).toFixed(1)} KB), runner pinned`);

  const { account, client } = makeClient(requirePrivateKey());
  step(`deployer ${account.address}`);
  step(`network  ${NETWORK} (gasless, rate limited to 60 req/min)`);

  step("submitting deploy transaction…");
  const hash = await client.deployContract({ code, args: [] });
  console.log(dim(`  tx ${hash}`));

  step("waiting for consensus…");
  const { receipt, execution, consensus } = await settle(client, hash, "deploy");
  ok(`decided — execution ${execution}, consensus ${consensus}`);

  const address = extractContractAddress(receipt);
  if (!address) {
    fail("deploy was decided but no contract address is present in the receipt.");
    console.log(dim(JSON.stringify(receipt, null, 2).slice(0, 2000)));
    process.exit(1);
  }

  // Sanity read: proves the contract really exists and its ABI is callable.
  try {
    const stats = await client.readContract({
      address,
      functionName: "get_stats",
      args: [],
    });
    ok(`get_stats() responded — ${stats.claims} claims, ${stats.attempts} attempts`);
  } catch (error) {
    warn(`contract deployed but get_stats() failed: ${error.message}`);
  }

  const record = {
    network: NETWORK,
    chainId: 61999,
    address,
    deployer: account.address,
    txHash: hash,
    contract: "contracts/replica_stake.py",
    runner: runnerLine.trim(),
    deployedAt: new Date().toISOString(),
  };
  const file = writeDeployment(NETWORK, record);
  upsertEnv("VITE_CONTRACT_ADDRESS", address);

  console.log(bold("\n  Deployed\n"));
  console.log(`  address  ${bold(address)}`);
  console.log(`  record   ${path.relative(ROOT, file)}`);
  console.log(`  .env     VITE_CONTRACT_ADDRESS updated`);
  console.log(dim("\n  Next: npm run seed    then    npm run dev\n"));
}

main().catch((error) => {
  fail(error.message);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
});
