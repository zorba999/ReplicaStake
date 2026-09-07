# ReplicaStake

**An on-chain court for computational reproducibility, built on GenLayer StudioNet.**

An author stakes credits behind exactly one number from their paper — one cell of one
table — together with the protocol needed to get it. A replicator runs the experiment
off-chain in public CI and posts the log. GenLayer validators then independently fetch
that log and settle the bond.

Evidence only counts if the replicator cannot have authored it: a blob pinned to the
registered commit, or a GitHub Actions run whose `head_sha` is that commit. Given evidence
that binds, the contract then makes three judgments that no deterministic chain and no
oracle can make on its own:

1. **Did the replicator follow the declared protocol?** (`YES` / `PARTIAL` / `NO`)
2. **What number did the run actually produce?**
3. **Is the gap to the claimed number inside a defensible tolerance?**

That is the whole reason this is a GenLayer app rather than a Solidity app.

---

## What is on-chain and what is not

| | |
|---|---|
| **On-chain** | The claim, the stake, the evidence pointer, the consensus verdict, the settlement. |
| **Off-chain** | The compute. GenLayer validators have no GPUs and never train anything — they adjudicate evidence that already exists. |
| **The honest limit** | A verdict is only as good as the evidence is hard to fake. The contract is built around immutable public artifacts (CI runs, raw logs pinned to a commit SHA), not pasted numbers. |

---

## Live deployment

| | |
|---|---|
| Network | `studionet` (chain id `61999`, gasless) |
| Contract | `0x5A847C2FE14eA9490D98887AF0aaDd369B6Bcfb2` |
| Source | [`contracts/replica_stake.py`](contracts/replica_stake.py) |
| Runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` (pinned) |

The seeded registry holds real claims against
[karpathy/nanoGPT](https://github.com/karpathy/nanoGPT) pinned at commit `3adf61e`. Every
evidence URL is genuinely public and genuinely fetched by the validators — nothing in the
demo is mocked. Adjudicated claims cover all three verdict paths and each reached
`MAJORITY_AGREE`; three claims are left pending so several visitors can each run a
consensus round from the UI and watch the stamp land.

Two of those verdicts are worth reading:

- An attempt described a fresh training run while pointing at the project README. The
  validators returned `INVALID_ATTEMPT` — correctly, because a README is documentation,
  not a run log.
- A **provenance control** claim submits a genuine, green GitHub Actions run from an
  unrelated repository. The contract rejects it on the GitHub API response, before any
  language model is asked to read anything: the run executed a different commit than the
  one the claim is registered against.

---

## Quick start

```bash
npm install
cp .env.example .env      # then paste your StudioNet key into DEPLOYER_PRIVATE_KEY
npm run deploy:contract   # writes deployments/studionet.json + VITE_CONTRACT_ADDRESS
npm run seed              # seven claims + attempts (add --adjudicate to settle them too)
npm run dev
```

StudioNet is **gasless**, so a `0 GEN` balance is expected and does not block anything.
It is also rate limited (60 req/min, 1000/hr), which is why the seed script throttles
between transactions.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on `:5173` |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run deploy:contract` | Deploys the contract, verifies it with a `get_stats()` read, records the address |
| `npm run seed` | Registers seven claims and their attempts |
| `npm run seed -- --adjudicate` | Also runs consensus on each one (slow; skips the held claim) |
| `npm run seed -- --only=3` | Seeds a single claim by index |
| `npm run lint:contract` | `genvm-lint check` — lint + SDK semantic validation |
| `npm run test:terminal` | Regression test for the terminal-state guard, against the live contract |

---

## Deploying the frontend to Vercel

The app is a static Vite SPA, so it deploys with no adapter and no server runtime.

1. Push the repo (`.env` is gitignored — **keep it that way**).
2. Import it on Vercel. The preset is detected from `vercel.json`: framework `vite`,
   build `npm run build`, output `dist`.
3. Open **Environment Variables**. Vercel pre-fills the list from `.env.example`, so it
   will offer `DEPLOYER_PRIVATE_KEY` and `REPLICATOR_PRIVATE_KEY` too — **remove both**.
   Keep exactly one:

   ```
   VITE_CONTRACT_ADDRESS = 0x5A847C2FE14eA9490D98887AF0aaDd369B6Bcfb2
   ```

4. Deploy. Build and output settings need no changes; `vercel.json` already pins
   `npm run build` and `dist`.

**Never add a private key to Vercel.** Anything prefixed `VITE_` is compiled into the
public JavaScript bundle, and even without that prefix a host env var is one misconfigured
build step away from being printed in a log. The deployer key belongs only in your local
`.env`, which `scripts/` reads and Vite never sees.

Without `VITE_CONTRACT_ADDRESS` the build still succeeds — the app just renders a "no
contract address configured" notice instead of the registry.

---

## The wallet adapter

`src/wallet/` exposes two connectors behind one interface, because StudioNet's gasless
design makes a zero-friction path genuinely possible:

- **Session key** — a keypair generated in the browser and kept in `localStorage`. It
  signs locally through viem. No extension, no popup, no funding step. This is the
  default path for anyone trying the demo.
- **Any EIP-1193 wallet** — discovered over **EIP-6963**, so MetaMask, Rabby, Brave,
  Coinbase Wallet and the rest are all listed by name instead of fighting over a single
  `window.ethereum` slot (with a legacy fallback for wallets that do not announce). The
  connect flow is `eth_requestAccounts` → switch to chain `61999`, adding it only if the
  wallet reports 4902 → `createClient({ chain: studionet, account, provider })`.

**Why not the SDK's `client.connect()`.** It hard-requires installing the
`npm:genlayer-wallet-plugin` MetaMask Snap, which fails on every non-MetaMask wallet
(`wallet_getSnaps` → `-32601`) and prompts for nothing this dApp uses: the snap belongs
to the SDK's separate `metamaskClient()` signer, whereas `writeContract` on an injected
account goes out as a plain `eth_sendTransaction` to the consensus contract. Doing the
chain handshake here instead keeps every EVM wallet working.

Wallets reject with plain `{ code, message }` objects rather than `Error` instances, so
`describeWalletError()` reads the EIP-1193 code first (4001 rejected, 4902 unknown chain,
-32002 request pending, -32601 unsupported method) and only then falls back to whatever
message-shaped field the wallet populated. `chainChanged` and `accountsChanged` are
followed live: landing on the wrong network flips the header to a switch prompt and
blocks writes rather than letting them fail at the RPC.

Reads never need a wallet: `src/lib/contract.ts` keeps a separate account-less client so
the registry is fully browsable before anyone connects.

**Address arguments.** GenLayer calldata has its own address type and the encoder does not
promote a hex string into it — passing `"0x…"` to a method typed `who: Address` sends a
`str` and the call fails. Every address argument goes through `toAddressArg()`, which wraps
the 20 raw bytes in `CalldataAddress`.

---

## Contract design notes

### Evidence provenance

The trust gap in the first version was that payout-bearing evidence was any URL the
replicator chose. That let a challenger fabricate a log on a page they controlled and
collect 70% of the author's stake. Evidence is now only accepted in two forms, neither of
which the submitter can author or alter after the fact:

| Tier | Form | Why it binds |
|---|---|---|
| `PINNED_BLOB` | `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>` where the sha **is** the registered commit | Git is content-addressed, so this can only ever serve the exact tree that was registered. Not even the author can change it afterwards. |
| `CI_RUN` | `github.com/<owner>/<repo>/actions/runs/<id>` | Verified at adjudication against the public GitHub API: the run must be `completed`, have a usable conclusion, and its `head_sha` must equal the registered commit. The run may live in a fork — what is pinned is the code that executed, not who executed it. |

Anything else is rejected **deterministically at submission**, before a bond is taken and
before a validator round is spent. An optional metrics artifact may sit at a different
commit only when the GitHub commits API shows that commit was written by the Actions bot
of the same repository, so run output stays machine-authored rather than hand-edited.

A provenance failure is a **verdict**, not a transaction error: the attempt settles as
`INVALID_ATTEMPT` and the challenger loses half their bond. Failing the transaction
instead would leave the bond locked and cost the honest party nothing.

`provenance_ok` is part of the consensus comparison, because chain of custody is a
deterministic fact — validators disagreeing about it means one of them read a different
history.

### Terminal claim states

`BROKEN` and `CLOSED` are terminal. `REPRODUCED` deliberately is not: a later attempt may
still break a claim an earlier one confirmed.

Before this was enforced, two attempts could be pending at once, and settling them in the
wrong order let a stale `REPRODUCED` overwrite a claim that had already been slashed —
laundering a broken claim back to clean. Now an attempt whose claim has reached a terminal
state is voided before any consensus round: the bond is returned in full, the claim state
is untouched, and the attempt is recorded as `VOID`. The same guard is repeated inside
`_settle()` so no future caller can route around it.

### Which equivalence principle, and why

`adjudicate()` uses **`gl.vm.run_nondet`** with a hand-written validator rather than
`prompt_comparative`. The validator re-does the whole task — re-fetches the evidence,
re-extracts the number — and then agreement is checked on three things:

- the `verdict` field must match exactly;
- the `protocol_followed == "NO"` boundary must match, because that is what decides
  whether fault lands on the author or the replicator;
- the extracted value must agree within a **reading** tolerance (`max(0.05, 1%)`, capped
  at half the scientific tolerance). That is "did we read the same line", not "is the
  paper right".

Confidence and prose are deliberately **not** compared — they are noise, and comparing
them would turn every round into a rotation.

### Error taxonomy

Validators compare error messages, so every failure is prefixed:

| Prefix | Meaning | Consensus behaviour |
|---|---|---|
| `[EXPECTED]` | business logic | exact match required |
| `[EXTERNAL]` | 4xx from the evidence host | exact match required |
| `[TRANSIENT]` | 5xx / empty render | agree if both are transient (`compare_user_errors`) |
| `[LLM_ERROR]` | model returned something unusable | never agree — force a rotation |

The validator calls the leader function *first*, so when the same deterministic failure
hits both nodes, `run_nondet` compares the two `UserError`s instead of asking the
validator to vote. Transient failures are allowed to differ in wording; nothing else is.

### The third verdict

`INVALID_ATTEMPT` is what stops this from being a griefing machine. Without it, anyone
could run the code wrong on purpose and collect a slashed stake. It costs the replicator
half their bond and leaves the author's stake untouched.

### Credits, not GEN

StudioNet is gasless and accounts hold `0 GEN`, so real value transfer is not available
there. Stakes therefore run on an internal `u256` atto-scale ledger with a one-per-address
`claim_credits()` grant. On a value-bearing network this would become a payable contract;
the settlement logic would not change.

### Storage

Non-deterministic blocks cannot reach storage, so `adjudicate()` snapshots every field it
needs into plain locals before entering the block, and the helper functions live at module
scope so nothing captures `self`.

---

## Frontend notes

Vite + React + GSAP, no UI framework. The look is deliberate: warm millimetre paper, a
live coordinate readout, hand-drawn annotations, and rubber-stamp verdicts — a lab
notebook, which is what a reproducibility registry actually is.

**Motion failsafe.** Every section animates in from a hidden start state, which means a
context where `requestAnimationFrame` never fires would leave the page blank forever
(this happens in some embedded and offscreen webviews). `src/anim/motion.ts` probes for a
frame; if none arrives it sets `no-motion` on `<html>`, and the stylesheet forces every
start state to its finished value. `reducedMotion()` then reports true, so all the
`gsap.set()` branches take over from the `gsap.to()` ones. The preloader carries its own
4-second timeout on top of that. The same path serves `prefers-reduced-motion`.

---

## Project layout

```
contracts/replica_stake.py   the intelligent contract
scripts/deploy.mjs           deploy + verify + record the address
scripts/seed.mjs             live demo data against real public artifacts
scripts/lib.mjs              client factory, receipt handling, .env writing
src/lib/                     chain client, typed views, tx console log bus
src/wallet/                  session-key + MetaMask adapter
src/anim/motion.ts           GSAP setup, reveal helpers, motion failsafe
src/components/              page sections and the claim drawer
```

---

## Known limits

- **Provenance binds the code, not the hardware.** A verified `CI_RUN` proves the
  registered commit was executed by GitHub Actions and concluded; it does not prove a GPU
  ran, or that the workflow measured what it claims to measure. The remaining surface is
  the workflow definition itself, which is why the protocol text is what validators judge
  compliance against.
- **GitHub Actions logs need auth.** The run object is public, but log and artifact
  downloads are not, so the numeric payload comes from a pinned blob or a bot-committed
  metrics file rather than the raw log stream.
- **The GitHub API is rate limited** to 60 requests/hour per IP unencumbered by a token.
  Every validator in a round makes its own call, so `CI_RUN` evidence is the expensive
  path; `PINNED_BLOB` evidence makes no API call at all.
- **No appeals in this build.** StudioNet's chain config carries no appeals or fee-manager
  contract, so `client.appealTransaction` is unavailable. On Asimov the appeal path would
  be a natural addition to the drawer.
- **Adjudication is retriable, not automatic.** `adjudicate()` is a separate transaction
  from `submit_replication()` on purpose: if a round fails on a transient fetch or an LLM
  error, the evidence is already safely on chain and anyone can trigger a fresh round.
