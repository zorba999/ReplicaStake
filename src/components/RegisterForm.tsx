import { useEffect, useRef, useState } from "react";

import { gsap, revealOnScroll } from "../anim/motion";
import { CREDIT_SYMBOL } from "../lib/config";
import { cleanContractError, send } from "../lib/contract";
import { slugId } from "../lib/format";
import { log, logErr, logOk } from "../lib/log";
import { useWallet } from "../wallet/WalletContext";

const EMPTY = {
  title: "",
  paper_url: "",
  locator: "",
  metric: "",
  claimed_value: "",
  tolerance: "",
  repo_url: "",
  commit_sha: "",
  protocol: "",
  stake: "250",
};

const EXAMPLE = {
  title: "Attention Is All You Need — EN-DE BLEU, base model",
  paper_url: "https://arxiv.org/abs/1706.03762",
  locator: "Table 2, row 'Transformer (base model)', column 'EN-DE BLEU'",
  metric: "BLEU on newstest2014 EN-DE (higher is better)",
  claimed_value: "27.3",
  tolerance: "0.4",
  repo_url: "https://github.com/tensorflow/tensor2tensor",
  commit_sha: "c1b7cf0e0b93d3e19b3c1e0e4c1b8f0d9a6e2b41",
  protocol:
    "Train transformer_base on WMT14 EN-DE for 100k steps on 8 GPUs, average the " +
    "last 5 checkpoints, decode newstest2014 with beam size 4 and length penalty " +
    "0.6, then report tokenised BLEU from the standard script. One seed.",
  stake: "400",
};

interface Props {
  onRegistered: () => void;
  credits: string;
  faucetUsed: boolean;
  onFaucet: () => void;
}

export default function RegisterForm({ onRegistered, credits, faucetUsed, onFaucet }: Props) {
  const wallet = useWallet();
  const rootRef = useRef<HTMLElement>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const context = gsap.context(() => revealOnScroll(root), rootRef);
    return () => context.revert();
  }, []);

  const set = (key: keyof typeof EMPTY) => (event: { target: { value: string } }) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const submit = async () => {
    if (!wallet.client) {
      setError("Connect a wallet first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const claimId = slugId("cl", form.title || "claim");
      log(`register_claim: staking ${form.stake} ${CREDIT_SYMBOL}`);
      const outcome = await send(
        wallet.client,
        "register_claim",
        [
          claimId,
          form.title.trim(),
          form.paper_url.trim(),
          form.locator.trim(),
          form.metric.trim(),
          form.claimed_value.trim(),
          form.tolerance.trim(),
          form.repo_url.trim(),
          form.commit_sha.trim(),
          form.protocol.trim(),
          form.stake.trim(),
        ],
        (message) => log(message),
      );
      logOk(`claim ${claimId} bonded (${outcome.consensus.toLowerCase()})`);
      setForm(EMPTY);
      onRegistered();
    } catch (caught) {
      const message = cleanContractError(
        caught instanceof Error ? caught.message : String(caught),
      );
      setError(message);
      logErr(`register_claim: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const short = Number(credits || 0) < Number(form.stake || 0);

  return (
    <section className="section" ref={rootRef} id="stake">
      <div className="section-head reveal">
        <h2>Stake a claim</h2>
        <span className="micro">one number, one protocol, one bond</span>
      </div>

      <div className="mech reveal">
        <div className="form">
          <div className="field">
            <label htmlFor="title">paper</label>
            <input id="title" value={form.title} onChange={set("title")} placeholder="Paper title" />
          </div>

          <div className="form form--two">
            <div className="field">
              <label htmlFor="paper_url">paper url</label>
              <input id="paper_url" value={form.paper_url} onChange={set("paper_url")} />
            </div>
            <div className="field">
              <label htmlFor="repo_url">repo url</label>
              <input id="repo_url" value={form.repo_url} onChange={set("repo_url")} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="locator">where in the paper</label>
            <input
              id="locator"
              value={form.locator}
              onChange={set("locator")}
              placeholder="Table 3, row 'Ours', column 'CIFAR-10'"
            />
          </div>

          <div className="field">
            <label htmlFor="metric">metric</label>
            <input
              id="metric"
              value={form.metric}
              onChange={set("metric")}
              placeholder="top-1 accuracy (%)"
            />
          </div>

          <div className="form form--two">
            <div className="field">
              <label htmlFor="claimed_value">claimed value</label>
              <input id="claimed_value" value={form.claimed_value} onChange={set("claimed_value")} />
            </div>
            <div className="field">
              <label htmlFor="tolerance">absolute tolerance</label>
              <input id="tolerance" value={form.tolerance} onChange={set("tolerance")} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="commit_sha">commit sha</label>
            <input
              id="commit_sha"
              value={form.commit_sha}
              onChange={set("commit_sha")}
              placeholder="full 40-character SHA, not a branch"
            />
            <small>
              A branch can be rewritten under you. Pinning the SHA is what makes the claim
              settleable a year from now.
            </small>
          </div>

          <div className="field">
            <label htmlFor="protocol">protocol</label>
            <textarea
              id="protocol"
              value={form.protocol}
              onChange={set("protocol")}
              placeholder="Entry point, dataset and split, seed count, hardware, and exactly which number to report."
            />
            <small>
              Validators judge compliance against this text. Vagueness here is what turns a
              replication into an argument.
            </small>
          </div>

          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="stake">stake ({CREDIT_SYMBOL})</label>
            <input id="stake" value={form.stake} onChange={set("stake")} />
            <small>minimum 100 · you hold {credits || "0"}</small>
          </div>

          {error && <div className="form__error">{error}</div>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy || wallet.kind === "none" || short}
              onClick={() => void submit()}
            >
              <span>
                {busy
                  ? "bonding…"
                  : wallet.kind === "none"
                    ? "connect a wallet"
                    : short
                      ? "not enough credits"
                      : "bond this claim"}
              </span>
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setForm(EXAMPLE)}
              disabled={busy}
            >
              <span>load an example</span>
            </button>
            {wallet.kind !== "none" && !faucetUsed && (
              <button type="button" className="btn btn--ghost" onClick={onFaucet} disabled={busy}>
                <span>claim 10 000 {CREDIT_SYMBOL}</span>
              </button>
            )}
          </div>
        </div>

        <aside className="mech__aside">
          <h4>What you are actually signing up for</h4>
          <dl>
            <dt>if it holds</dt>
            <dd>
              Your stake stays put and the claim carries a consensus-backed REPRODUCED mark
              that anyone can read from chain.
            </dd>
            <dt>if it breaks</dt>
            <dd>
              70% of the stake goes to whoever proved it, the rest to the treasury, and the
              claim is marked BROKEN permanently.
            </dd>
            <dt>if the challenger is sloppy</dt>
            <dd>
              INVALID_ATTEMPT costs them half their bond and leaves your stake untouched.
              You are not exposed to bad-faith noise.
            </dd>
            <dt>credits</dt>
            <dd>
              StudioNet is gasless and accounts hold 0 GEN, so stakes run on an internal
              ledger. One 10 000 {CREDIT_SYMBOL} grant per address.
            </dd>
          </dl>
        </aside>
      </div>
    </section>
  );
}
