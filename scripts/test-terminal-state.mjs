/**
 * Regression test for the flaw a reviewer found: two attempts can be in flight
 * at once, and settling them in the wrong order let a stale REPRODUCED overwrite
 * a claim that had already been slashed — laundering a broken claim back to
 * clean, and doing it from an already-emptied stake.
 *
 *   node scripts/test-terminal-state.mjs
 *
 * Runs against the live contract, so it costs two real consensus rounds.
 */
import {
  bold,
  cyan,
  dim,
  fail,
  green,
  makeClient,
  ok,
  readDeployment,
  red,
  requirePrivateKey,
  settle,
  sleep,
  step,
  toAddressArg,
} from "./lib.mjs";

const NANOGPT_SHA = "3adf61e154c3fe3fca428ad6bc3818b27a3b8291";
const EVIDENCE = `https://raw.githubusercontent.com/karpathy/nanoGPT/${NANOGPT_SHA}/README.md`;
const RUN = Date.now().toString(36);

let failures = 0;

function expect(label, actual, wanted) {
  const pass = String(actual) === String(wanted);
  if (pass) console.log(`  ${green("PASS")} ${label} = ${actual}`);
  else {
    failures += 1;
    console.log(`  ${red("FAIL")} ${label} = ${actual}, expected ${wanted}`);
  }
}

async function main() {
  const address = process.env.VITE_CONTRACT_ADDRESS || readDeployment("studionet")?.address;
  if (!address) throw new Error("No contract address. Deploy first.");

  const author = makeClient(requirePrivateKey());
  const replicator = makeClient(requirePrivateKey("REPLICATOR_PRIVATE_KEY"));

  console.log(bold("\n  Terminal-state regression test\n"));
  step(`contract ${address}`);

  const read = (fn, args) =>
    author.client.readContract({ address, functionName: fn, args });
  const write = async (client, fn, args, label) => {
    const hash = await client.writeContract({ address, functionName: fn, args });
    return settle(client, hash, label);
  };

  // The claimed value is deliberately absurd against a locator the validators
  // have already agreed on, so attempt A lands on FAILED without the reading
  // itself being the thing under test.
  const claimId = `stale-${RUN}`;
  step(`registering ${cyan(claimId)} — a claim the evidence will break`);
  await write(
    author.client,
    "register_claim",
    [
      claimId,
      "Terminal-state regression fixture",
      "https://github.com/karpathy/nanoGPT#baselines",
      "Baselines table, row 'gpt2 124M', column 'val loss'",
      "validation loss on OpenWebText (lower is better)",
      "9.99",
      "0.05",
      "https://github.com/karpathy/nanoGPT",
      NANOGPT_SHA,
      "Read the single 'val loss' figure published for the gpt2 124M model in the " +
        "baselines table of the repository at the pinned commit. This claim is a " +
        "documented-baseline check, not a fresh training run.",
      "400",
    ],
    "register",
  );
  await sleep(2000);

  // Two attempts in flight at the same time. This is the whole point: nothing
  // stops a claim collecting several challenges before any of them settles.
  for (const suffix of ["a", "b"]) {
    step(`submitting attempt ${dim(suffix)}`);
    await write(
      replicator.client,
      "submit_replication",
      [
        `stale-${RUN}-${suffix}`,
        claimId,
        EVIDENCE,
        "",
        "Reporting the val loss figure published in the pinned baselines table for " +
          "the gpt2 124M model at this commit.",
      ],
      `submit ${suffix}`,
    );
    await sleep(2000);
  }

  const beforeBalance = Number((await read("get_balance", [toAddressArg(replicator.account.address)])).credits);

  step("adjudicating attempt A — expected to break the claim");
  await write(replicator.client, "adjudicate", [`stale-${RUN}-a`], "adjudicate a");
  await sleep(3000);

  const afterA = await read("get_claim", [claimId]);
  const attemptA = await read("get_attempt", [`stale-${RUN}-a`]);
  console.log(dim(`  attempt A verdict: ${attemptA.verdict} (observed ${attemptA.observed_value})`));

  if (attemptA.verdict !== "FAILED") {
    console.log(
      `  ${red("SKIP")} attempt A settled as ${attemptA.verdict}, not FAILED — the claim never ` +
        `reached a terminal state, so this run cannot exercise the guard.`,
    );
    process.exit(1);
  }

  expect("claim status after A", afterA.status, "BROKEN");
  expect("claim stake after A", afterA.stake, "0");

  step("adjudicating the stale attempt B — must not resurrect the claim");
  await write(replicator.client, "adjudicate", [`stale-${RUN}-b`], "adjudicate b");
  await sleep(3000);

  const afterB = await read("get_claim", [claimId]);
  const attemptB = await read("get_attempt", [`stale-${RUN}-b`]);
  const afterBalance = Number((await read("get_balance", [toAddressArg(replicator.account.address)])).credits);

  expect("stale attempt verdict", attemptB.verdict, "VOID");
  expect("stale attempt settled", attemptB.settled, "true");
  expect("claim status after B", afterB.status, "BROKEN");
  expect("claim stake after B", afterB.stake, "0");

  // The bond comes back untouched: the replicator did nothing wrong, the claim
  // simply ran out of stake before their round.
  const bond = Number(attemptB.bond);
  expect("bond refunded in full", afterBalance - beforeBalance >= bond, "true");

  console.log(
    failures === 0
      ? bold(green("\n  All checks passed — a terminal claim cannot be relabelled.\n"))
      : bold(red(`\n  ${failures} check(s) failed.\n`)),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  fail(error.message);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
});
