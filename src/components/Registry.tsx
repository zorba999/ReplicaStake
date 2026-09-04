import { useEffect, useMemo, useRef, useState } from "react";

import { gsap, revealOnScroll } from "../anim/motion";
import type { Claim } from "../lib/types";
import ClaimCard from "./ClaimCard";

const FILTERS = [
  { id: "all", label: "all" },
  { id: "OPEN", label: "bonded" },
  { id: "pending", label: "awaiting verdict" },
  { id: "REPRODUCED", label: "reproduced" },
  { id: "BROKEN", label: "slashed" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

interface Props {
  claims: Claim[];
  loading: boolean;
  error: string;
  onOpen: (claim: Claim) => void;
  onRefresh: () => void;
}

export default function Registry({ claims, loading, error, onOpen, onRefresh }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<FilterId>("all");

  const visible = useMemo(() => {
    if (filter === "all") return claims;
    if (filter === "pending") return claims.filter((claim) => Number(claim.pending) > 0);
    return claims.filter((claim) => claim.status === filter);
  }, [claims, filter]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const context = gsap.context(() => revealOnScroll(root), rootRef);
    return () => context.revert();
  }, [visible.length]);

  return (
    <section className="section" ref={rootRef} id="registry">
      <div className="section-head reveal">
        <h2>The registry</h2>
        <span className="micro">
          {loading ? "reading studionet…" : `${claims.length} claims on chain`}
        </span>
      </div>

      <div className="registry__bar reveal">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`chip${filter === option.id ? " is-on" : ""}`}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          style={{ marginLeft: "auto" }}
          onClick={onRefresh}
        >
          refresh
        </button>
      </div>

      {error && <div className="form__error reveal">{error}</div>}

      {!error && visible.length === 0 && (
        <div className="empty reveal">
          <p className="micro">
            {loading ? "loading…" : "nothing here yet — stake the first claim below"}
          </p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="cards">
          {visible.map((claim) => (
            <ClaimCard key={claim.claim_id} claim={claim} onOpen={() => onOpen(claim)} />
          ))}
        </div>
      )}
    </section>
  );
}
