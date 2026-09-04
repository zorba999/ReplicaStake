# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
ReplicaStake — an on-chain court for computational reproducibility.

An author stakes credits behind one concrete numeric claim from a paper
("Table 3, row Ours, column CIFAR-10 = 94.2 accuracy") plus the exact protocol
needed to reproduce it. A replicator runs the experiment off-chain in public CI
and submits the evidence URL. GenLayer validators then independently fetch that
evidence and judge three things no deterministic contract can judge:

  1. did the replicator actually follow the declared protocol?
  2. what number did the run actually produce?
  3. is the gap to the claimed number inside a defensible tolerance?

The verdict settles the stake. Everything else (compute, storage of artifacts,
UI) stays off-chain — the chain owns only the judgment and the money.
"""

from genlayer import *

import dataclasses
import json
import typing

# --------------------------------------------------------------------------
# Error taxonomy. Validators compare error messages, so the prefix decides
# whether a failure is "both of us saw the same deterministic problem" (agree)
# or "the network flaked / the LLM misbehaved" (disagree, force rotation).
# --------------------------------------------------------------------------
ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

# --------------------------------------------------------------------------
# Domain constants
# --------------------------------------------------------------------------
VERDICT_REPRODUCED = "REPRODUCED"
VERDICT_FAILED = "FAILED"
VERDICT_INVALID = "INVALID_ATTEMPT"
VERDICTS = (VERDICT_REPRODUCED, VERDICT_FAILED, VERDICT_INVALID)

CLAIM_OPEN = "OPEN"
CLAIM_REPRODUCED = "REPRODUCED"
CLAIM_BROKEN = "BROKEN"
CLAIM_CLOSED = "CLOSED"

ATTO = 10**18
FAUCET_ATTO = 10_000 * ATTO
MIN_STAKE_ATTO = 100 * ATTO
BOND_BPS = 500  # replicator posts 5% of the stake as an anti-spam bond
SLASH_REPLICATOR_BPS = 7000  # 70% of a broken stake goes to the replicator
INVALID_BURN_BPS = 5000  # half the bond is burnt on a sloppy attempt

EVIDENCE_HEAD_CHARS = 4000
EVIDENCE_TAIL_CHARS = 9000

RAW_HOSTS = (
    "raw.githubusercontent.com",
    "gist.githubusercontent.com",
    "api.github.com",
    "objects.githubusercontent.com",
    "zenodo.org/records",
)
RAW_SUFFIXES = (".json", ".txt", ".log", ".md", ".csv", ".yaml", ".yml", ".jsonl")


# --------------------------------------------------------------------------
# Storage records
# --------------------------------------------------------------------------
@allow_storage
@dataclasses.dataclass
class Claim:
    claim_id: str
    author: Address
    title: str
    paper_url: str
    locator: str  # "Table 3, row 'Ours', column 'CIFAR-10'"
    metric: str  # "top-1 accuracy (%)"
    claimed_value: str  # "94.2" — kept as text, exactly as printed
    tolerance: str  # "0.5" absolute
    repo_url: str
    commit_sha: str
    protocol: str  # natural language, this is what validators judge against
    atto_stake: u256
    status: str
    spec_score: u256  # 0 = never audited, else 1..100
    spec_notes: str
    attempt_ids: DynArray[str]


@allow_storage
@dataclasses.dataclass
class Attempt:
    attempt_id: str
    claim_id: str
    replicator: Address
    evidence_url: str
    metrics_url: str
    notes: str
    atto_bond: u256
    verdict: str  # "" until adjudicated
    observed_value: str
    delta: str
    protocol_followed: str  # YES | PARTIAL | NO
    confidence: u256
    reasoning: str
    settled: bool


# --------------------------------------------------------------------------
# Pure helpers. These live at module scope on purpose: the non-deterministic
# blocks are cloudpickled and must never capture `self` (storage is not
# reachable from inside a nondet block).
# --------------------------------------------------------------------------
def _clip(text: str) -> str:
    """Keep the head (setup/config) and the tail (final metrics) of a long log."""
    if len(text) <= EVIDENCE_HEAD_CHARS + EVIDENCE_TAIL_CHARS:
        return text
    head = text[:EVIDENCE_HEAD_CHARS]
    tail = text[-EVIDENCE_TAIL_CHARS:]
    return head + "\n\n...[TRUNCATED " + str(len(text)) + " CHARS]...\n\n" + tail


def _is_raw_url(url: str) -> bool:
    low = url.lower()
    for host in RAW_HOSTS:
        if host in low:
            return True
    for suffix in RAW_SUFFIXES:
        if low.endswith(suffix):
            return True
    return False


def _fetch_text(url: str) -> str:
    """Fetch evidence. Raw endpoints go over plain HTTP, pages get rendered."""
    if not url:
        return ""
    if _is_raw_url(url):
        res = gl.nondet.web.get(url, headers={"Accept": "text/plain, application/json"})
        if res.status >= 500:
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} evidence host unavailable")
        if res.status >= 400:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} evidence fetch returned {res.status}")
        body = res.body or b""
        return _clip(body.decode("utf-8", errors="replace"))
    rendered = gl.nondet.web.render(url, mode="text", wait_after_loaded="1200ms")
    if not isinstance(rendered, str) or len(rendered.strip()) < 40:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} evidence page rendered empty")
    return _clip(rendered)


def _extract_json(raw: typing.Any) -> dict:
    """LLMs wrap JSON in prose, add trailing commas, or return a bare string."""
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        raise gl.vm.UserError(f"{ERROR_LLM} unusable response type {type(raw)}")
    first = raw.find("{")
    last = raw.rfind("}")
    if first < 0 or last <= first:
        raise gl.vm.UserError(f"{ERROR_LLM} no JSON object in response")
    body = raw[first : last + 1]
    try:
        parsed = json.loads(body)
    except Exception:
        import re

        cleaned = re.sub(r",(\s*[}\]])", r"\1", body)
        try:
            parsed = json.loads(cleaned)
        except Exception:
            raise gl.vm.UserError(f"{ERROR_LLM} malformed JSON in response")
    if not isinstance(parsed, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} JSON root is not an object")
    return parsed


def _pick(data: dict, *keys: str) -> str:
    for key in keys:
        if key in data and data[key] is not None:
            return str(data[key]).strip()
    return ""


def _to_float(value: str) -> float | None:
    """Parse '94.2', '94.2%', '0.942', ' 94,2 ' — return None when hopeless."""
    if value is None:
        return None
    text = str(value).strip().replace("%", "").replace(",", ".")
    if not text:
        return None
    kept = ""
    for ch in text:
        if ch.isdigit() or ch in "+-.eE":
            kept += ch
        elif kept:
            break
    try:
        return float(kept)
    except Exception:
        return None


def _clamp_confidence(value: str) -> int:
    parsed = _to_float(value)
    if parsed is None:
        return 50
    if parsed <= 1.0 and parsed > 0.0:
        parsed = parsed * 100.0
    return max(0, min(100, int(round(parsed))))


def _adjudication_prompt(
    title: str,
    paper_url: str,
    locator: str,
    metric: str,
    claimed_value: str,
    tolerance: str,
    repo_url: str,
    commit_sha: str,
    protocol: str,
    notes: str,
    evidence: str,
    metrics_blob: str,
) -> str:
    return f"""You adjudicate a computational reproducibility bounty. Be strict and literal.

# THE REGISTERED CLAIM
Paper: {title} ({paper_url})
Location in paper: {locator}
Metric: {metric}
Claimed value: {claimed_value}
Accepted absolute tolerance: {tolerance}
Reference code: {repo_url} at commit {commit_sha}
Protocol the author declared:
\"\"\"{protocol}\"\"\"

# THE REPLICATION ATTEMPT
Replicator notes: {notes or "(none)"}

Primary evidence fetched from the replicator's public run:
\"\"\"{evidence or "(empty)"}\"\"\"

Secondary metrics artifact:
\"\"\"{metrics_blob or "(none provided)"}\"\"\"

# WHAT TO DECIDE
Step 1 — Evidence integrity. Does the evidence look like a real execution log or
metrics artifact from the reference code? Does any commit SHA it mentions match
{commit_sha}? A mismatched or absent SHA is a strong signal, not an automatic
rejection: judge it together with the rest of the evidence.

Step 2 — Protocol compliance. Did the run follow the declared protocol (same
script or entry point, same dataset split, same number of seeds, unchanged
hyperparameters)? Answer YES, PARTIAL or NO.

Step 3 — Observed value. Extract the single final number for "{metric}" that the
run produced. If the protocol asks for a mean over seeds, compute that mean. Use
the same units as the claimed value: if the claim is a percentage and the log
reports a fraction, convert it.

Step 4 — Verdict.
- "INVALID_ATTEMPT" if the evidence is unusable, the run crashed, or protocol
  compliance is NO. The claim is untouched; this is the replicator's fault.
- "REPRODUCED" if |observed - claimed| <= {tolerance} and compliance is YES or
  PARTIAL in a way that does not favour the result.
- "FAILED" if compliance is acceptable but |observed - claimed| > {tolerance}.
Do not stretch the tolerance out of politeness, and do not shrink it either.

# OUTPUT
Return ONLY this JSON object:
{{"verdict": "REPRODUCED" | "FAILED" | "INVALID_ATTEMPT",
  "observed_value": "<number as a plain string, or empty if none could be read>",
  "delta": "<signed observed - claimed, plain string, or empty>",
  "protocol_followed": "YES" | "PARTIAL" | "NO",
  "confidence": <integer 0-100>,
  "reasoning": "<max 60 words, cite the concrete line or field you used>"}}"""


def _normalise_adjudication(raw: typing.Any, claimed_value: str) -> dict:
    data = _extract_json(raw)

    verdict = _pick(data, "verdict", "decision", "result", "status").upper()
    verdict = verdict.replace(" ", "_").replace("-", "_")
    if verdict in ("INVALID", "INVALID_ATTEMPT", "INCONCLUSIVE", "UNUSABLE"):
        verdict = VERDICT_INVALID
    if verdict in ("REPRODUCED", "REPRODUCIBLE", "PASS", "PASSED", "MATCH"):
        verdict = VERDICT_REPRODUCED
    if verdict in ("FAILED", "FAIL", "NOT_REPRODUCED", "MISMATCH"):
        verdict = VERDICT_FAILED
    if verdict not in VERDICTS:
        raise gl.vm.UserError(f"{ERROR_LLM} unknown verdict '{verdict}'")

    compliance = _pick(data, "protocol_followed", "compliance", "protocol").upper()
    if compliance not in ("YES", "NO", "PARTIAL"):
        compliance = "PARTIAL"

    observed = _pick(data, "observed_value", "observed", "value", "measured")
    observed_num = _to_float(observed)

    delta = _pick(data, "delta", "difference", "gap")
    claimed_num = _to_float(claimed_value)
    if not delta and observed_num is not None and claimed_num is not None:
        delta = f"{observed_num - claimed_num:+.4f}"

    reasoning = _pick(data, "reasoning", "rationale", "explanation", "analysis")
    if len(reasoning) > 600:
        reasoning = reasoning[:600]

    # A settlement verdict without a number behind it is not a settlement.
    if verdict in (VERDICT_REPRODUCED, VERDICT_FAILED) and observed_num is None:
        raise gl.vm.UserError(f"{ERROR_LLM} settlement verdict with no observed value")

    return {
        "verdict": verdict,
        "observed_value": "" if observed_num is None else f"{observed_num:g}",
        "delta": delta,
        "protocol_followed": compliance,
        "confidence": _clamp_confidence(_pick(data, "confidence", "certainty")),
        "reasoning": reasoning,
    }


def _values_agree(leader_value: str, validator_value: str, tolerance: str) -> bool:
    """Two validators reading the same log must land on the same number."""
    a = _to_float(leader_value)
    b = _to_float(validator_value)
    if a is None or b is None:
        return a is None and b is None
    # Reading tolerance is much tighter than the scientific tolerance: this is
    # "did we read the same line", not "is the paper right".
    slack = max(0.05, abs(a) * 0.01)
    tol = _to_float(tolerance)
    if tol is not None:
        slack = min(slack, max(0.01, tol / 2.0))
    return abs(a - b) <= slack


def _compare_user_errors(a: gl.vm.UserError, b: gl.vm.UserError) -> bool:
    """Transient failures are allowed to differ in wording; nothing else is."""
    if a.message.startswith(ERROR_TRANSIENT) and b.message.startswith(ERROR_TRANSIENT):
        return True
    return a.message == b.message


def _spec_prompt(
    title: str,
    paper_url: str,
    locator: str,
    metric: str,
    claimed_value: str,
    tolerance: str,
    commit_sha: str,
    protocol: str,
    readme: str,
) -> str:
    return f"""You audit whether a reproducibility claim is specified well enough to be
settled later by a third party who has never spoken to the author.

Claim: {title} ({paper_url})
Location: {locator}
Metric: {metric} = {claimed_value} (tolerance {tolerance})
Pinned commit: {commit_sha}
Declared protocol:
\"\"\"{protocol}\"\"\"

Repository README as fetched:
\"\"\"{readme or "(could not be read)"}\"\"\"

Score 0-100 on how executable and unambiguous this is. Penalise heavily:
a protocol that names no entry point, no dataset or split, no seed count; a
metric whose units are ambiguous; a README that contradicts the protocol; a
tolerance that is missing or absurdly wide. Reward a protocol a stranger could
run tonight.

Return ONLY: {{"score": <0-100>, "verdict": "EXECUTABLE" | "AMBIGUOUS" | "UNSPECIFIED",
"notes": "<max 45 words naming the single biggest gap>"}}"""


def _normalise_spec(raw: typing.Any) -> dict:
    data = _extract_json(raw)
    score = _to_float(_pick(data, "score", "rating", "points"))
    if score is None:
        raise gl.vm.UserError(f"{ERROR_LLM} spec audit returned no score")
    score_int = max(1, min(100, int(round(score))))
    verdict = _pick(data, "verdict", "label", "status").upper()
    if verdict not in ("EXECUTABLE", "AMBIGUOUS", "UNSPECIFIED"):
        verdict = "EXECUTABLE" if score_int >= 70 else ("AMBIGUOUS" if score_int >= 40 else "UNSPECIFIED")
    notes = _pick(data, "notes", "reasoning", "comment")
    return {"score": score_int, "verdict": verdict, "notes": notes[:400]}


# --------------------------------------------------------------------------
# Contract
# --------------------------------------------------------------------------
class ReplicaStake(gl.Contract):
    owner: Address
    treasury_atto: u256
    total_locked_atto: u256

    credits: TreeMap[Address, u256]
    faucet_used: TreeMap[Address, bool]
    reputation: TreeMap[Address, u256]

    claims: TreeMap[str, Claim]
    claim_ids: DynArray[str]
    attempts: TreeMap[str, Attempt]
    attempt_ids: DynArray[str]

    counters: TreeMap[str, u256]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.treasury_atto = u256(0)
        self.total_locked_atto = u256(0)

    # ---------------------------------------------------------------- helpers
    def _bump(self, key: str, by: int = 1) -> None:
        current = self.counters.get(key, u256(0))
        self.counters[key] = u256(int(current) + by)

    def _balance(self, who: Address) -> int:
        return int(self.credits.get(who, u256(0)))

    def _debit(self, who: Address, amount: int) -> None:
        balance = self._balance(who)
        if balance < amount:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} insufficient credits: have {balance // ATTO}, need {amount // ATTO}"
            )
        self.credits[who] = u256(balance - amount)

    def _credit(self, who: Address, amount: int) -> None:
        self.credits[who] = u256(self._balance(who) + amount)

    def _reward_reputation(self, who: Address, points: int) -> None:
        self.reputation[who] = u256(int(self.reputation.get(who, u256(0))) + points)

    # ------------------------------------------------------------ write: setup
    @gl.public.write
    def claim_credits(self) -> None:
        """StudioNet is gasless and accounts hold 0 GEN, so stakes run on an
        internal credit ledger. One grant per address."""
        sender = gl.message.sender_address
        if self.faucet_used.get(sender, False):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} faucet already used by this address")
        self.faucet_used[sender] = True
        self._credit(sender, FAUCET_ATTO)
        self._bump("faucet_grants")

    # ------------------------------------------------------------ write: claims
    @gl.public.write
    def register_claim(
        self,
        claim_id: str,
        title: str,
        paper_url: str,
        locator: str,
        metric: str,
        claimed_value: str,
        tolerance: str,
        repo_url: str,
        commit_sha: str,
        protocol: str,
        stake: str,
    ) -> str:
        sender = gl.message.sender_address
        claim_id = claim_id.strip()

        if not claim_id or len(claim_id) > 64:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} claim_id must be 1-64 characters")
        if claim_id in self.claims:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} claim_id already registered")
        if not paper_url.startswith("http") or not repo_url.startswith("http"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} paper_url and repo_url must be http(s) URLs")
        if len(commit_sha.strip()) < 7:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} pin a commit SHA (>= 7 chars), not a branch")
        if _to_float(claimed_value) is None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} claimed_value must be numeric")
        if _to_float(tolerance) is None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} tolerance must be numeric")
        if len(protocol.strip()) < 30:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} protocol must be at least 30 characters")

        atto_stake = int(_to_float(stake) or 0) * ATTO
        if atto_stake < MIN_STAKE_ATTO:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} minimum stake is {MIN_STAKE_ATTO // ATTO} RSC")

        self._debit(sender, atto_stake)
        self.total_locked_atto = u256(int(self.total_locked_atto) + atto_stake)

        self.claims[claim_id] = Claim(
            claim_id=claim_id,
            author=sender,
            title=title[:200],
            paper_url=paper_url,
            locator=locator[:200],
            metric=metric[:120],
            claimed_value=claimed_value.strip(),
            tolerance=tolerance.strip(),
            repo_url=repo_url,
            commit_sha=commit_sha.strip(),
            protocol=protocol[:4000],
            atto_stake=u256(atto_stake),
            status=CLAIM_OPEN,
            spec_score=u256(0),
            spec_notes="",
            attempt_ids=[],
        )
        self.claim_ids.append(claim_id)
        self._bump("claims_registered")
        return claim_id

    @gl.public.write
    def close_claim(self, claim_id: str) -> None:
        """The author withdraws a bond nobody challenged."""
        if claim_id not in self.claims:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown claim")
        claim = self.claims[claim_id]
        sender = gl.message.sender_address
        if claim.author != sender:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the author can close a claim")
        if claim.status not in (CLAIM_OPEN, CLAIM_REPRODUCED):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} claim is not closeable in status {claim.status}")
        for attempt_id in claim.attempt_ids:
            if self.attempts[attempt_id].verdict == "":
                raise gl.vm.UserError(f"{ERROR_EXPECTED} an attempt is still awaiting adjudication")

        refund = int(claim.atto_stake)
        claim.status = CLAIM_CLOSED
        claim.atto_stake = u256(0)
        self.total_locked_atto = u256(int(self.total_locked_atto) - refund)
        self._credit(sender, refund)
        self._bump("claims_closed")

    # --------------------------------------------------------- write: attempts
    @gl.public.write
    def submit_replication(
        self,
        attempt_id: str,
        claim_id: str,
        evidence_url: str,
        metrics_url: str,
        notes: str,
    ) -> str:
        sender = gl.message.sender_address
        attempt_id = attempt_id.strip()

        if not attempt_id or len(attempt_id) > 64:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} attempt_id must be 1-64 characters")
        if attempt_id in self.attempts:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} attempt_id already used")
        if claim_id not in self.claims:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown claim")
        claim = self.claims[claim_id]
        if claim.status not in (CLAIM_OPEN, CLAIM_REPRODUCED):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} claim is not accepting attempts")
        if claim.author == sender:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} an author cannot replicate their own claim")
        if not evidence_url.startswith("http"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} evidence_url must be an http(s) URL")

        atto_bond = int(claim.atto_stake) * BOND_BPS // 10_000
        self._debit(sender, atto_bond)
        self.total_locked_atto = u256(int(self.total_locked_atto) + atto_bond)

        self.attempts[attempt_id] = Attempt(
            attempt_id=attempt_id,
            claim_id=claim_id,
            replicator=sender,
            evidence_url=evidence_url,
            metrics_url=metrics_url,
            notes=notes[:1000],
            atto_bond=u256(atto_bond),
            verdict="",
            observed_value="",
            delta="",
            protocol_followed="",
            confidence=u256(0),
            reasoning="",
            settled=False,
        )
        self.attempt_ids.append(attempt_id)
        claim.attempt_ids.append(attempt_id)
        self._bump("attempts_submitted")
        return attempt_id

    # ------------------------------------------------- write: the consensus core
    @gl.public.write
    def adjudicate(self, attempt_id: str) -> str:
        """Fetch the evidence, judge it, settle the stake. Anyone may trigger it."""
        if attempt_id not in self.attempts:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown attempt")
        attempt = self.attempts[attempt_id]
        if attempt.verdict != "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} attempt already adjudicated")
        claim = self.claims[attempt.claim_id]

        # Snapshot storage into plain locals — a nondet block cannot touch storage.
        title = str(claim.title)
        paper_url = str(claim.paper_url)
        locator = str(claim.locator)
        metric = str(claim.metric)
        claimed_value = str(claim.claimed_value)
        tolerance = str(claim.tolerance)
        repo_url = str(claim.repo_url)
        commit_sha = str(claim.commit_sha)
        protocol = str(claim.protocol)
        evidence_url = str(attempt.evidence_url)
        metrics_url = str(attempt.metrics_url)
        notes = str(attempt.notes)

        def leader_fn() -> dict:
            evidence = _fetch_text(evidence_url)
            metrics_blob = _fetch_text(metrics_url) if metrics_url else ""
            raw = gl.nondet.exec_prompt(
                _adjudication_prompt(
                    title,
                    paper_url,
                    locator,
                    metric,
                    claimed_value,
                    tolerance,
                    repo_url,
                    commit_sha,
                    protocol,
                    notes,
                    evidence,
                    metrics_blob,
                ),
                response_format="json",
            )
            return _normalise_adjudication(raw, claimed_value)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            # Re-do the work first: if the same deterministic failure hits us,
            # run_nondet compares the two UserErrors instead of calling this.
            mine = leader_fn()
            if not isinstance(leaders_res, gl.vm.Return):
                return False  # leader failed where we succeeded — disagree
            theirs = leaders_res.calldata
            if not isinstance(theirs, dict):
                return False
            if str(theirs.get("verdict", "")) != mine["verdict"]:
                return False
            # Only the NO boundary matters: it is what flips fault to the replicator.
            leader_blocked = str(theirs.get("protocol_followed", "")) == "NO"
            if leader_blocked != (mine["protocol_followed"] == "NO"):
                return False
            return _values_agree(
                str(theirs.get("observed_value", "")), mine["observed_value"], tolerance
            )

        result = gl.vm.run_nondet(
            leader_fn, validator_fn, compare_user_errors=_compare_user_errors
        )

        attempt.verdict = str(result["verdict"])
        attempt.observed_value = str(result["observed_value"])
        attempt.delta = str(result["delta"])
        attempt.protocol_followed = str(result["protocol_followed"])
        attempt.confidence = u256(int(result["confidence"]))
        attempt.reasoning = str(result["reasoning"])

        self._settle(attempt.attempt_id)
        return str(result["verdict"])

    def _settle(self, attempt_id: str) -> None:
        """Deterministic money movement driven purely by the consensus verdict."""
        attempt = self.attempts[attempt_id]
        if attempt.settled:
            return
        claim = self.claims[attempt.claim_id]

        bond = int(attempt.atto_bond)
        verdict = str(attempt.verdict)

        if verdict == VERDICT_INVALID:
            burnt = bond * INVALID_BURN_BPS // 10_000
            self._credit(attempt.replicator, bond - burnt)
            self.treasury_atto = u256(int(self.treasury_atto) + burnt)
            self.total_locked_atto = u256(int(self.total_locked_atto) - bond)
            self._bump("verdict_invalid")

        elif verdict == VERDICT_REPRODUCED:
            self._credit(attempt.replicator, bond)
            self.total_locked_atto = u256(int(self.total_locked_atto) - bond)
            self._reward_reputation(attempt.replicator, 10)
            claim.status = CLAIM_REPRODUCED
            self._bump("verdict_reproduced")

        elif verdict == VERDICT_FAILED:
            stake = int(claim.atto_stake)
            to_replicator = stake * SLASH_REPLICATOR_BPS // 10_000
            to_treasury = stake - to_replicator
            self._credit(attempt.replicator, bond + to_replicator)
            self.treasury_atto = u256(int(self.treasury_atto) + to_treasury)
            self.total_locked_atto = u256(int(self.total_locked_atto) - bond - stake)
            self._reward_reputation(attempt.replicator, 25)
            claim.atto_stake = u256(0)
            claim.status = CLAIM_BROKEN
            self._bump("verdict_failed")

        else:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} cannot settle verdict '{verdict}'")

        attempt.settled = True

    # ------------------------------------------------- write: spec quality audit
    @gl.public.write
    def audit_protocol(self, claim_id: str) -> u256:
        """Score how executable the declared protocol is. Anyone may trigger it."""
        if claim_id not in self.claims:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown claim")
        claim = self.claims[claim_id]
        if int(claim.spec_score) != 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} claim already audited")

        title = str(claim.title)
        paper_url = str(claim.paper_url)
        locator = str(claim.locator)
        metric = str(claim.metric)
        claimed_value = str(claim.claimed_value)
        tolerance = str(claim.tolerance)
        commit_sha = str(claim.commit_sha)
        protocol = str(claim.protocol)
        repo_url = str(claim.repo_url)

        def leader_fn() -> dict:
            readme = ""
            try:
                readme = _fetch_text(repo_url)
            except gl.vm.UserError as err:
                if not err.message.startswith(ERROR_TRANSIENT):
                    raise
            raw = gl.nondet.exec_prompt(
                _spec_prompt(
                    title,
                    paper_url,
                    locator,
                    metric,
                    claimed_value,
                    tolerance,
                    commit_sha,
                    protocol,
                    readme,
                ),
                response_format="json",
            )
            return _normalise_spec(raw)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            mine = leader_fn()
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            theirs = leaders_res.calldata
            if not isinstance(theirs, dict):
                return False
            if str(theirs.get("verdict", "")) != mine["verdict"]:
                return False
            leader_score = _to_float(str(theirs.get("score", "")))
            if leader_score is None:
                return False
            return abs(leader_score - mine["score"]) <= 20

        result = gl.vm.run_nondet(
            leader_fn, validator_fn, compare_user_errors=_compare_user_errors
        )

        claim.spec_score = u256(int(result["score"]))
        claim.spec_notes = f"{result['verdict']}: {result['notes']}"
        self._bump("protocols_audited")
        return claim.spec_score

    # ------------------------------------------------------------------- views
    @gl.public.view
    def get_balance(self, who: Address) -> dict:
        return {
            "address": who.as_hex,
            "credits": str(self._balance(who) // ATTO),
            "reputation": str(int(self.reputation.get(who, u256(0)))),
            "faucet_used": bool(self.faucet_used.get(who, False)),
        }

    @gl.public.view
    def get_stats(self) -> dict:
        return {
            "claims": str(len(self.claim_ids)),
            "attempts": str(len(self.attempt_ids)),
            "registered": str(int(self.counters.get("claims_registered", u256(0)))),
            "reproduced": str(int(self.counters.get("verdict_reproduced", u256(0)))),
            "failed": str(int(self.counters.get("verdict_failed", u256(0)))),
            "invalid": str(int(self.counters.get("verdict_invalid", u256(0)))),
            "audited": str(int(self.counters.get("protocols_audited", u256(0)))),
            "locked": str(int(self.total_locked_atto) // ATTO),
            "treasury": str(int(self.treasury_atto) // ATTO),
        }

    @gl.public.view
    def get_claim(self, claim_id: str) -> dict:
        if claim_id not in self.claims:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown claim")
        return self._claim_dict(self.claims[claim_id], full=True)

    @gl.public.view
    def get_claims(self, offset: u32, limit: u32) -> dict:
        total = len(self.claim_ids)
        start = min(int(offset), total)
        end = min(start + max(1, int(limit)), total)
        items = []
        for index in range(start, end):
            items.append(self._claim_dict(self.claims[self.claim_ids[index]], full=False))
        return {"total": str(total), "offset": str(start), "items": items}

    @gl.public.view
    def get_attempts(self, claim_id: str) -> dict:
        if claim_id not in self.claims:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown claim")
        items = []
        for attempt_id in self.claims[claim_id].attempt_ids:
            items.append(self._attempt_dict(self.attempts[attempt_id]))
        return {"claim_id": claim_id, "items": items}

    @gl.public.view
    def get_attempt(self, attempt_id: str) -> dict:
        if attempt_id not in self.attempts:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown attempt")
        return self._attempt_dict(self.attempts[attempt_id])

    # --------------------------------------------------------------- projectors
    def _claim_dict(self, claim: Claim, full: bool) -> dict:
        pending = 0
        for attempt_id in claim.attempt_ids:
            if self.attempts[attempt_id].verdict == "":
                pending += 1
        base = {
            "claim_id": str(claim.claim_id),
            "author": claim.author.as_hex,
            "title": str(claim.title),
            "paper_url": str(claim.paper_url),
            "locator": str(claim.locator),
            "metric": str(claim.metric),
            "claimed_value": str(claim.claimed_value),
            "tolerance": str(claim.tolerance),
            "repo_url": str(claim.repo_url),
            "commit_sha": str(claim.commit_sha),
            "stake": str(int(claim.atto_stake) // ATTO),
            "status": str(claim.status),
            "spec_score": str(int(claim.spec_score)),
            "spec_notes": str(claim.spec_notes),
            "attempts": str(len(claim.attempt_ids)),
            "pending": str(pending),
        }
        if full:
            base["protocol"] = str(claim.protocol)
        return base

    def _attempt_dict(self, attempt: Attempt) -> dict:
        return {
            "attempt_id": str(attempt.attempt_id),
            "claim_id": str(attempt.claim_id),
            "replicator": attempt.replicator.as_hex,
            "evidence_url": str(attempt.evidence_url),
            "metrics_url": str(attempt.metrics_url),
            "notes": str(attempt.notes),
            "bond": str(int(attempt.atto_bond) // ATTO),
            "verdict": str(attempt.verdict),
            "observed_value": str(attempt.observed_value),
            "delta": str(attempt.delta),
            "protocol_followed": str(attempt.protocol_followed),
            "confidence": str(int(attempt.confidence)),
            "reasoning": str(attempt.reasoning),
            "settled": bool(attempt.settled),
        }
