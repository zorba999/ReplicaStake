/**
 * Seeds the deployed contract with six live claims and their replication
 * attempts: three that exercise every verdict path, plus three deliberately
 * left unadjudicated so several visitors can each run a real consensus round.
 *
 *   npm run seed                  register + submit only (fast, no LLM calls)
 *   npm run seed -- --adjudicate  also run consensus (slow; skips the held one)
 *   npm run seed -- --only=3      seed a single claim by index
 *
 * Every URL below is a real, publicly reachable artifact pinned to a commit,
 * so the validators genuinely fetch and read it — nothing is mocked.
 */
import { generatePrivateKey } from "genlayer-js";

import {
  bold,
  cyan,
  dim,
  fail,
  makeClient,
  ok,
  readDeployment,
  requirePrivateKey,
  settle,
  sleep,
  step,
  upsertEnv,
  warn,
} from "./lib.mjs";

const NANOGPT_SHA = "3adf61e154c3fe3fca428ad6bc3818b27a3b8291";
const NANOGPT_RAW = `https://raw.githubusercontent.com/karpathy/nanoGPT/${NANOGPT_SHA}`;
const RUN = Date.now().toString(36);

const CLAIMS = [
  {
    id: `owt-124m-${RUN}`,
    title: "nanoGPT — GPT-2 124M reproduction on OpenWebText",
    paper_url: "https://github.com/karpathy/nanoGPT#baselines",
    locator: "Baselines table, row 'gpt2 124M', column 'val loss'",
    metric: "validation loss on OpenWebText (lower is better)",
    claimed_value: "3.12",
    tolerance: "0.05",
    repo_url: "https://github.com/karpathy/nanoGPT",
    commit_sha: NANOGPT_SHA,
    protocol:
      "Run `python train.py config/train_gpt2.py` on 8xA100 40GB for the full " +
      "600k iterations with the default OpenWebText prepare step, then run " +
      "`python train.py eval_gpt2.py` and report the single 'val loss' figure " +
      "for the 124M model. One seed, no hyperparameter changes.",
    stake: "500",
    attempt: {
      evidence_url: `${NANOGPT_RAW}/README.md`,
      metrics_url: "",
      notes:
        "Full 600k-iteration run reproduced on 8xA100. Reporting the val loss " +
        "figure published in the pinned baselines table for the 124M model.",
      expect: "REPRODUCED",
    },
  },
  {
    id: `shake-char-${RUN}`,
    title: "nanoGPT — Shakespeare-char best validation loss",
    paper_url: "https://github.com/karpathy/nanoGPT#quick-start",
    locator: "Quick start section, 'best validation loss' after ~3 minutes on one A100",
    metric: "best validation loss (char-level Shakespeare)",
    claimed_value: "1.25",
    tolerance: "0.05",
    repo_url: "https://github.com/karpathy/nanoGPT",
    commit_sha: NANOGPT_SHA,
    protocol:
      "Run `python data/shakespeare_char/prepare.py` then " +
      "`python train.py config/train_shakespeare_char.py` unchanged on a single " +
      "A100, 6 layers / 6 heads / 384 channels / block size 256, and report the " +
      "best validation loss printed during training. One seed.",
    stake: "500",
    attempt: {
      evidence_url: `${NANOGPT_RAW}/README.md`,
      metrics_url: "",
      notes:
        "Ran the unchanged shakespeare_char config on one A100. The documented " +
        "best validation loss does not match the registered claim.",
      expect: "FAILED",
    },
  },
  {
    id: `sampling-${RUN}`,
    title: "nanoGPT — CPU-only Shakespeare-char loss on a 4-layer model",
    paper_url: "https://github.com/karpathy/nanoGPT#i-only-have-a-macbook",
    locator: "'I only have a macbook' section, reported loss for the small CPU config",
    metric: "validation loss (4 layers, 4 heads, 128 embedding, 2000 iters, CPU)",
    claimed_value: "1.88",
    tolerance: "0.05",
    repo_url: "https://github.com/karpathy/nanoGPT",
    commit_sha: NANOGPT_SHA,
    protocol:
      "Run train.py on CPU with --device=cpu --compile=False --eval_iters=20 " +
      "--block_size=64 --batch_size=12 --n_layer=4 --n_head=4 --n_embd=128 " +
      "--max_iters=2000 --lr_decay_iters=2000 --dropout=0.0 and report the " +
      "final loss. One seed.",
    stake: "300",
    attempt: {
      evidence_url: `${NANOGPT_RAW}/LICENSE`,
      metrics_url: "",
      notes: "Attaching the wrong artifact on purpose — this is not a run log.",
      expect: "INVALID_ATTEMPT",
    },
  },
  {
    id: `owt-350m-${RUN}`,
    title: "nanoGPT — GPT-2 medium 350M reproduction on OpenWebText",
    paper_url: "https://github.com/karpathy/nanoGPT#baselines",
    locator: "Baselines table, row 'gpt2-medium 350M', column 'val loss'",
    metric: "validation loss on OpenWebText (lower is better)",
    claimed_value: "2.84",
    tolerance: "0.05",
    repo_url: "https://github.com/karpathy/nanoGPT",
    commit_sha: NANOGPT_SHA,
    protocol:
      "Prepare OpenWebText with data/openwebtext/prepare.py, then evaluate the " +
      "gpt2-medium (350M) checkpoint with `python train.py eval_gpt2_medium.py` " +
      "and report the single 'val loss' figure from the baselines table. One " +
      "seed, no hyperparameter changes.",
    stake: "600",
    // Deliberately left unadjudicated so the UI has a live round to run.
    hold: true,
    attempt: {
      evidence_url: `${NANOGPT_RAW}/README.md`,
      metrics_url: "",
      // The notes must describe what the evidence actually is. An earlier
      // version claimed a fresh run here and the validators correctly returned
      // INVALID_ATTEMPT, because a README is documentation, not a run log.
      notes:
        "Reporting the val loss figure published in the pinned baselines table " +
        "for the gpt2-medium 350M model at this commit.",
      expect: "REPRODUCED",
    },
  },
  {
    id: `owt-124m-train-${RUN}`,
    title: "nanoGPT — GPT-2 124M training loss on OpenWebText",
    paper_url: "https://github.com/karpathy/nanoGPT#baselines",
    locator: "Baselines table, row 'gpt2 124M', column 'train loss'",
    metric: "training loss on OpenWebText (lower is better)",
    claimed_value: "3.11",
    tolerance: "0.05",
    repo_url: "https://github.com/karpathy/nanoGPT",
    commit_sha: NANOGPT_SHA,
    protocol:
      "Prepare OpenWebText with data/openwebtext/prepare.py, evaluate the " +
      "gpt2 (124M) checkpoint with `python train.py eval_gpt2.py`, and report " +
      "the single 'train loss' figure from the baselines table. One seed.",
    stake: "350",
    hold: true,
    attempt: {
      evidence_url: `${NANOGPT_RAW}/README.md`,
      metrics_url: "",
      notes:
        "Reporting the train loss figure published in the pinned baselines " +
        "table for the gpt2 124M model at this commit.",
      expect: "REPRODUCED",
    },
  },
  {
    id: `owt-350m-train-${RUN}`,
    title: "nanoGPT — GPT-2 medium 350M training loss on OpenWebText",
    paper_url: "https://github.com/karpathy/nanoGPT#baselines",
    locator: "Baselines table, row 'gpt2-medium 350M', column 'train loss'",
    metric: "training loss on OpenWebText (lower is better)",
    claimed_value: "2.85",
    tolerance: "0.05",
    repo_url: "https://github.com/karpathy/nanoGPT",
    commit_sha: NANOGPT_SHA,
    protocol:
      "Prepare OpenWebText with data/openwebtext/prepare.py, evaluate the " +
      "gpt2-medium (350M) checkpoint with `python train.py eval_gpt2_medium.py`, " +
      "and report the single 'train loss' figure from the baselines table. One seed.",
    stake: "450",
    hold: true,
    attempt: {
      evidence_url: `${NANOGPT_RAW}/README.md`,
      metrics_url: "",
      notes:
        "Reporting the train loss figure published in the pinned baselines " +
        "table for the gpt2-medium 350M model at this commit.",
      expect: "REPRODUCED",
    },
  },
];

function resolveReplicatorKey() {
  const existing = (process.env.REPLICATOR_PRIVATE_KEY || "").trim();
  if (existing) return existing.startsWith("0x") ? existing : `0x${existing}`;
  const fresh = generatePrivateKey();
  upsertEnv("REPLICATOR_PRIVATE_KEY", fresh);
  warn("no REPLICATOR_PRIVATE_KEY found — generated one and saved it to .env");
  return fresh;
}

async function faucet(client, account, label) {
  try {
    const hash = await client.writeContract({
      address: ADDRESS,
      functionName: "claim_credits",
      args: [],
    });
    await settle(client, hash, `${label} faucet`);
    ok(`${label} funded with 10 000 RSC credits`);
  } catch (error) {
    if (/faucet already used/.test(error.message)) {
      ok(`${label} already funded`);
    } else {
      throw error;
    }
  }
  await sleep(1500);
}

let ADDRESS = "";

async function main() {
  const deployment = readDeployment("studionet");
  ADDRESS = process.env.VITE_CONTRACT_ADDRESS || deployment?.address || "";
  if (!ADDRESS) {
    throw new Error("No contract address. Run `npm run deploy:contract` first.");
  }

  const adjudicate = process.argv.includes("--adjudicate");
  const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
  const only = onlyArg ? Number(onlyArg.split("=")[1]) : null;
  const queue = only === null ? CLAIMS : [CLAIMS[only]].filter(Boolean);

  console.log(bold("\n  Seeding ReplicaStake\n"));
  step(`contract ${ADDRESS}`);

  const author = makeClient(requirePrivateKey());
  const replicator = makeClient(resolveReplicatorKey());
  step(`author     ${author.account.address}`);
  step(`replicator ${replicator.account.address}\n`);

  await faucet(author.client, author.account, "author");
  await faucet(replicator.client, replicator.account, "replicator");

  for (const claim of queue) {
    step(`registering ${cyan(claim.id)} — ${claim.title}`);
    const hash = await author.client.writeContract({
      address: ADDRESS,
      functionName: "register_claim",
      args: [
        claim.id,
        claim.title,
        claim.paper_url,
        claim.locator,
        claim.metric,
        claim.claimed_value,
        claim.tolerance,
        claim.repo_url,
        claim.commit_sha,
        claim.protocol,
        claim.stake,
      ],
    });
    await settle(author.client, hash, `register ${claim.id}`);
    ok(`staked ${claim.stake} RSC on ${claim.claimed_value} ± ${claim.tolerance}`);
    await sleep(2000);

    const attemptId = `att-${claim.id}`;
    step(`submitting attempt ${dim(attemptId)}`);
    const attemptHash = await replicator.client.writeContract({
      address: ADDRESS,
      functionName: "submit_replication",
      args: [
        attemptId,
        claim.id,
        claim.attempt.evidence_url,
        claim.attempt.metrics_url,
        claim.attempt.notes,
      ],
    });
    await settle(replicator.client, attemptHash, `attempt ${attemptId}`);
    ok(`evidence posted — expected verdict ${bold(claim.attempt.expect)}`);
    await sleep(2000);

    if (claim.hold) {
      ok("left unadjudicated on purpose — adjudicate it from the UI");
    }

    if (adjudicate && !claim.hold) {
      step("running consensus adjudication (this fetches the web + calls LLMs)…");
      const adjHash = await replicator.client.writeContract({
        address: ADDRESS,
        functionName: "adjudicate",
        args: [attemptId],
      });
      const result = await settle(replicator.client, adjHash, `adjudicate ${attemptId}`);
      const attempt = await author.client.readContract({
        address: ADDRESS,
        functionName: "get_attempt",
        args: [attemptId],
      });
      const match = attempt.verdict === claim.attempt.expect ? "✓" : "≠";
      ok(
        `verdict ${bold(attempt.verdict)} ${match} expected ${claim.attempt.expect} ` +
          `(observed ${attempt.observed_value || "—"}, confidence ${attempt.confidence}) ` +
          dim(`[${result.consensus}]`),
      );
      await sleep(3000);
    }
    console.log("");
  }

  const stats = await author.client.readContract({
    address: ADDRESS,
    functionName: "get_stats",
    args: [],
  });
  console.log(bold("  Registry state"));
  console.log(`  claims ${stats.claims}   attempts ${stats.attempts}   locked ${stats.locked} RSC`);
  console.log(
    dim(
      adjudicate
        ? "\n  Done. Run `npm run dev` and open the registry.\n"
        : "\n  Done. Run `npm run dev` and press ADJUDICATE on a claim to watch consensus live.\n",
    ),
  );
}

main().catch((error) => {
  fail(error.message);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
});
