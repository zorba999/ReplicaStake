/** Every view on the contract returns strings so nothing is lost in calldata. */

export type ClaimStatus = "OPEN" | "REPRODUCED" | "BROKEN" | "CLOSED";
export type Verdict = "" | "REPRODUCED" | "FAILED" | "INVALID_ATTEMPT" | "VOID";
export type Provenance = "" | "PINNED_BLOB" | "CI_RUN";

export interface Claim {
  claim_id: string;
  author: string;
  title: string;
  paper_url: string;
  locator: string;
  metric: string;
  claimed_value: string;
  tolerance: string;
  repo_url: string;
  commit_sha: string;
  stake: string;
  status: ClaimStatus;
  spec_score: string;
  spec_notes: string;
  attempts: string;
  pending: string;
  /** Only present on get_claim, not on the list projection. */
  protocol?: string;
}

export interface Attempt {
  attempt_id: string;
  claim_id: string;
  replicator: string;
  evidence_url: string;
  metrics_url: string;
  notes: string;
  bond: string;
  verdict: Verdict;
  observed_value: string;
  delta: string;
  protocol_followed: "" | "YES" | "PARTIAL" | "NO";
  confidence: string;
  reasoning: string;
  settled: boolean;
  /** How the evidence is bound to the registered commit. */
  provenance: Provenance;
  provenance_repo: string;
  provenance_ref: string;
}

export interface Stats {
  claims: string;
  attempts: string;
  registered: string;
  reproduced: string;
  failed: string;
  invalid: string;
  void: string;
  audited: string;
  locked: string;
  treasury: string;
}

export interface Balance {
  address: string;
  credits: string;
  reputation: string;
  faucet_used: boolean;
}

export type LogLevel = "info" | "ok" | "err";

export interface LogLine {
  id: number;
  at: number;
  level: LogLevel;
  text: string;
}
