import { useCallback, useEffect, useRef, useState } from "react";

import { gsap, reducedMotion } from "../anim/motion";
import { api, cleanContractError, send } from "../lib/contract";
import { CREDIT_SYMBOL } from "../lib/config";
import { shortAddress, shortSha, slugId, statusClass } from "../lib/format";
import { log, logErr, logOk } from "../lib/log";
import type { Attempt, Claim } from "../lib/types";
import { useWallet } from "../wallet/WalletContext";

const VERDICT_LABEL: Record<string, string> = {
  REPRODUCED: "reproduced",
  FAILED: "failed",
  INVALID_ATTEMPT: "invalid attempt",
  VOID: "void",
};

const PROVENANCE_LABEL: Record<string, string> = {
  PINNED_BLOB: "pinned to the registered commit",
  CI_RUN: "CI run bound to the registered commit",
};

interface Props {
  claimId: string | null;
  onClose: () => void;
  onSettled: () => void;
}

export default function ClaimDrawer({ claimId, onClose, onSettled }: Props) {
  const wallet = useWallet();
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [claim, setClaim] = useState<Claim | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [metricsUrl, setMetricsUrl] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async (id: string) => {
    const [nextClaim, nextAttempts] = await Promise.all([api.claim(id), api.attempts(id)]);
    setClaim(nextClaim);
    setAttempts(nextAttempts.items);
  }, []);

  useEffect(() => {
    if (!claimId) return;
    setError("");
    setClaim(null);
    setAttempts([]);
    void load(claimId).catch((caught) => setError(String(caught?.message ?? caught)));
  }, [claimId, load]);

  // Open / close choreography.
  useEffect(() => {
    const scrim = scrimRef.current;
    const panel = panelRef.current;
    if (!scrim || !panel) return;

    if (claimId) {
      document.body.classList.add("is-locked");
      if (reducedMotion()) {
        gsap.set(scrim, { opacity: 1 });
        gsap.set(panel, { xPercent: 0 });
      } else {
        gsap.to(scrim, { opacity: 1, duration: 0.35, ease: "power2.out" });
        gsap.to(panel, { xPercent: 0, duration: 0.7, ease: "expo.out" });
      }
    } else {
      document.body.classList.remove("is-locked");
      gsap.to(scrim, { opacity: 0, duration: 0.28 });
      gsap.to(panel, { xPercent: 100, duration: 0.5, ease: "power3.in" });
    }

    return () => document.body.classList.remove("is-locked");
  }, [claimId]);

  useEffect(() => {
    if (!claimId) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [claimId, onClose]);

  // Stamps land with a thump once a verdict exists.
  useEffect(() => {
    if (!attempts.length || reducedMotion()) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        ".stamp",
        { scale: 2.1, opacity: 0, rotate: -26 },
        {
          scale: 1,
          opacity: 0.9,
          rotate: -9,
          duration: 0.55,
          ease: "back.out(3)",
          stagger: 0.1,
        },
      );
    }, panelRef);
    return () => context.revert();
  }, [attempts]);

  const run = useCallback(
    async (label: string, fn: string, args: unknown[]) => {
      if (!wallet.client) {
        setError("Connect a wallet first.");
        return;
      }
      if (wallet.wrongNetwork) {
        setError("Your wallet is on another network — switch it to StudioNet first.");
        return;
      }
      setBusy(label);
      setError("");
      try {
        log(`${label}: submitting`);
        const outcome = await send(wallet.client, fn, args, (message) => log(message));
        logOk(`${label}: ${outcome.consensus.toLowerCase().replace(/_/g, " ")}`);
        if (claimId) await load(claimId);
        onSettled();
      } catch (caught) {
        const message = cleanContractError(
          caught instanceof Error ? caught.message : String(caught),
        );
        setError(message);
        logErr(`${label}: ${message}`);
      } finally {
        setBusy("");
      }
    },
    [wallet.client, wallet.wrongNetwork, claimId, load, onSettled],
  );

  const isAuthor =
    Boolean(claim) && wallet.address.toLowerCase() === (claim?.author ?? "").toLowerCase();
  const pendingAttempts = attempts.filter((attempt) => !attempt.verdict);
  const canSubmit = Boolean(claim) && !isAuthor && wallet.kind !== "none";

  return (
    <>
      <div
        className={`drawer-scrim${claimId ? " is-open" : ""}`}
        ref={scrimRef}
        onClick={onClose}
        style={{ pointerEvents: claimId ? "auto" : "none" }}
        aria-hidden
      />
      <aside
        className={`drawer${claimId ? " is-open" : ""}`}
        ref={panelRef}
        aria-hidden={!claimId}
        style={{ pointerEvents: claimId ? "auto" : "none" }}
      >
        <div className="drawer__inner">
          <div className="drawer__head">
            <div>
              <span className="micro">claim {claim?.claim_id ?? "…"}</span>
              <h2>{claim?.title ?? "Loading…"}</h2>
            </div>
            <button type="button" className="btn btn--sm btn--ghost" onClick={onClose}>
              <span>close</span>
            </button>
          </div>

          {claim && (
            <>
              <dl className="kv">
                <dt>status</dt>
                <dd>
                  <span className={statusClass(claim.status)}>{claim.status}</span>
                </dd>

                <dt>the number</dt>
                <dd>
                  <b style={{ fontFamily: "var(--font-mono)", fontSize: 18 }}>
                    {claim.claimed_value}
                  </b>{" "}
                  ± {claim.tolerance} — {claim.metric}
                </dd>

                <dt>located at</dt>
                <dd>{claim.locator}</dd>

                <dt>paper</dt>
                <dd>
                  <a href={claim.paper_url} target="_blank" rel="noreferrer noopener">
                    {claim.paper_url}
                  </a>
                </dd>

                <dt>code</dt>
                <dd>
                  <a href={claim.repo_url} target="_blank" rel="noreferrer noopener">
                    {claim.repo_url}
                  </a>{" "}
                  @ {shortSha(claim.commit_sha)}
                </dd>

                <dt>author</dt>
                <dd>{shortAddress(claim.author)}</dd>

                <dt>stake</dt>
                <dd>
                  {claim.stake} {CREDIT_SYMBOL} locked
                </dd>

                <dt>spec audit</dt>
                <dd>
                  {Number(claim.spec_score) > 0 ? (
                    <>
                      <b>{claim.spec_score}/100</b> — {claim.spec_notes}
                    </>
                  ) : (
                    <span style={{ color: "var(--ink-faint)" }}>
                      not audited yet — anyone can trigger a validator round
                    </span>
                  )}
                </dd>
              </dl>

              <span className="micro">declared protocol</span>
              <pre className="protocol" style={{ marginTop: 8 }}>
                {claim.protocol}
              </pre>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                {Number(claim.spec_score) === 0 && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={Boolean(busy) || wallet.kind === "none"}
                    onClick={() => void run("audit protocol", "audit_protocol", [claim.claim_id])}
                  >
                    <span>{busy === "audit protocol" ? "auditing…" : "audit the protocol"}</span>
                  </button>
                )}
                {isAuthor && (claim.status === "OPEN" || claim.status === "REPRODUCED") && (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    disabled={Boolean(busy) || pendingAttempts.length > 0}
                    onClick={() => void run("close claim", "close_claim", [claim.claim_id])}
                  >
                    <span>
                      {pendingAttempts.length > 0 ? "attempt pending" : "withdraw stake"}
                    </span>
                  </button>
                )}
              </div>

              <div className="section-head" style={{ marginTop: 34, marginBottom: 12 }}>
                <h2 style={{ fontSize: 18 }}>Replication attempts</h2>
                <span className="micro">{attempts.length} on record</span>
              </div>

              {attempts.length === 0 && (
                <p className="micro" style={{ padding: "12px 0" }}>
                  nobody has challenged this number yet
                </p>
              )}

              {attempts.map((attempt) => (
                <article className="attempt" key={attempt.attempt_id}>
                  {attempt.verdict && (
                    <span className={`stamp stamp--${attempt.verdict.toLowerCase()}`}>
                      {VERDICT_LABEL[attempt.verdict] ?? attempt.verdict}
                    </span>
                  )}

                  <div className="attempt__head">
                    <div>
                      <span className="micro">{shortAddress(attempt.replicator)}</span>
                      <div style={{ marginTop: 6, fontSize: 13, wordBreak: "break-all" }}>
                        <a
                          href={attempt.evidence_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          style={{ textDecoration: "underline", textUnderlineOffset: 3 }}
                        >
                          {attempt.evidence_url}
                        </a>
                      </div>
                    </div>
                  </div>

                  {attempt.provenance && (
                    <p className="tag" style={{ marginTop: 8 }}>
                      {PROVENANCE_LABEL[attempt.provenance] ?? attempt.provenance} ·{" "}
                      {attempt.provenance_repo} @ {attempt.provenance_ref.slice(0, 12)}
                    </p>
                  )}

                  {attempt.notes && <p className="attempt__reason">{attempt.notes}</p>}

                  {attempt.verdict ? (
                    <>
                      <div className="attempt__nums">
                        <div>
                          <span className="micro">observed</span>
                          <b>{attempt.observed_value || "—"}</b>
                        </div>
                        <div>
                          <span className="micro">delta</span>
                          <b>{attempt.delta || "—"}</b>
                        </div>
                        <div>
                          <span className="micro">protocol</span>
                          <b>{attempt.protocol_followed || "—"}</b>
                        </div>
                        <div>
                          <span className="micro">confidence</span>
                          <b>{attempt.confidence}%</b>
                        </div>
                      </div>
                      {attempt.reasoning && (
                        <p className="attempt__reason" style={{ marginTop: 14 }}>
                          {attempt.reasoning}
                        </p>
                      )}
                    </>
                  ) : (
                    <div style={{ marginTop: 14 }}>
                      <button
                        type="button"
                        className="btn btn--sm btn--solid"
                        disabled={Boolean(busy) || wallet.kind === "none"}
                        onClick={() =>
                          void run(
                            `adjudicate ${attempt.attempt_id}`,
                            "adjudicate",
                            [attempt.attempt_id],
                          )
                        }
                      >
                        <span>
                          {busy === `adjudicate ${attempt.attempt_id}`
                            ? "validators reading the log…"
                            : "adjudicate"}
                        </span>
                      </button>
                      <p className="micro" style={{ marginTop: 8 }}>
                        fetches the evidence, runs the equivalence principle, settles the stake
                      </p>
                    </div>
                  )}
                </article>
              ))}

              {canSubmit && claim.status !== "BROKEN" && claim.status !== "CLOSED" && (
                <>
                  <div className="section-head" style={{ marginTop: 34, marginBottom: 12 }}>
                    <h2 style={{ fontSize: 18 }}>Challenge this number</h2>
                    <span className="micro">
                      bond {Math.round(Number(claim.stake) * 0.05)} {CREDIT_SYMBOL}
                    </span>
                  </div>

                  <div className="form">
                    <div className="field">
                      <label htmlFor="evidence">evidence url</label>
                      <input
                        id="evidence"
                        value={evidenceUrl}
                        onChange={(event) => setEvidenceUrl(event.target.value)}
                        placeholder={`https://raw.githubusercontent.com/owner/repo/${claim.commit_sha}/results.log`}
                      />
                      <small>
                        Only two forms are accepted, because a payout must never rest on a
                        document you can edit: a <b>raw.githubusercontent.com</b> blob pinned
                        to the registered commit <code>{claim.commit_sha.slice(0, 7)}</code>,
                        or a <b>GitHub Actions run</b> whose head_sha is that commit. Anything
                        else is rejected before your bond is taken.
                      </small>
                    </div>
                    <div className="field">
                      <label htmlFor="metrics">metrics artifact (optional)</label>
                      <input
                        id="metrics"
                        value={metricsUrl}
                        onChange={(event) => setMetricsUrl(event.target.value)}
                        placeholder="https://raw.githubusercontent.com/owner/repo/<sha>/metrics.json"
                      />
                      <small>
                        Must sit in the same repository as the evidence. If it is at a
                        different commit, that commit has to have been written by the Actions
                        bot — hand-committed numbers do not count.
                      </small>
                    </div>
                    <div className="field">
                      <label htmlFor="notes">what you ran</label>
                      <textarea
                        id="notes"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Seeds, hardware, any deviation from the declared protocol."
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn--solid"
                      disabled={Boolean(busy) || !evidenceUrl.trim()}
                      onClick={() =>
                        void run("submit replication", "submit_replication", [
                          slugId("att", claim.claim_id),
                          claim.claim_id,
                          evidenceUrl.trim(),
                          metricsUrl.trim(),
                          notes.trim(),
                        ]).then(() => {
                          setEvidenceUrl("");
                          setMetricsUrl("");
                          setNotes("");
                        })
                      }
                    >
                      <span>
                        {busy === "submit replication" ? "posting evidence…" : "post evidence"}
                      </span>
                    </button>
                  </div>
                </>
              )}

              {isAuthor && (
                <p className="micro" style={{ marginTop: 24 }}>
                  you registered this claim — authors cannot replicate their own work
                </p>
              )}
              {wallet.kind === "none" && (
                <p className="micro" style={{ marginTop: 24 }}>
                  connect a wallet to adjudicate or challenge
                </p>
              )}

              {error && (
                <div className="form__error" style={{ marginTop: 16 }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
