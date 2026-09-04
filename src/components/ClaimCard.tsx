import { shortAddress, shortSha, statusClass } from "../lib/format";
import type { Claim } from "../lib/types";

const STATUS_LABEL: Record<string, string> = {
  OPEN: "bonded",
  REPRODUCED: "reproduced",
  BROKEN: "stake slashed",
  CLOSED: "withdrawn",
};

export default function ClaimCard({ claim, onOpen }: { claim: Claim; onOpen: () => void }) {
  const pending = Number(claim.pending) > 0;
  const score = Number(claim.spec_score);

  return (
    <button type="button" className="card reveal" onClick={onOpen}>
      <div className="card__top">
        <span className={statusClass(claim.status)}>
          {STATUS_LABEL[claim.status] ?? claim.status}
        </span>
        <span className="tag">{claim.stake} RSC</span>
      </div>

      <h3>{claim.title}</h3>
      <p className="card__locator">{claim.locator}</p>

      <div className="card__value">
        <b>{claim.claimed_value}</b>
        <span className="tag">± {claim.tolerance}</span>
        <span className="tag" style={{ marginLeft: "auto", textAlign: "right" }}>
          {claim.metric}
        </span>
      </div>

      <div className="card__meta">
        <span className="tag">@{shortSha(claim.commit_sha)}</span>
        <span className="tag">{shortAddress(claim.author)}</span>
        <span className="tag">
          {claim.attempts} attempt{claim.attempts === "1" ? "" : "s"}
        </span>
        {pending && (
          <span className="tag" style={{ color: "var(--stamp-amber)" }}>
            ● awaiting adjudication
          </span>
        )}
        {score > 0 && (
          <span
            className="tag"
            style={{ color: score >= 70 ? "var(--stamp-green)" : "var(--stamp-amber)" }}
          >
            spec {score}/100
          </span>
        )}
      </div>
    </button>
  );
}
