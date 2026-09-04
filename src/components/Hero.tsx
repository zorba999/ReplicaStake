import { useEffect, useRef } from "react";

import { buildMaskedLines, countUp, gsap, reducedMotion } from "../anim/motion";
import type { Stats } from "../lib/types";

const LINES = ["A court for numbers", "that refuse", "to reproduce."];

interface Props {
  stats: Stats | null;
  onBrowse: () => void;
  onRegister: () => void;
}

export default function Hero({ stats, onBrowse, onRegister }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const heading = headingRef.current;
    const root = rootRef.current;
    if (!heading || !root) return;

    const context = gsap.context(() => {
      const targets = buildMaskedLines(heading, LINES);

      if (reducedMotion()) {
        gsap.set(targets, { yPercent: 0 });
        gsap.set(".hero__note, .hero__fade", { opacity: 1, y: 0 });
        return;
      }

      gsap.set(targets, { yPercent: 115 });
      gsap.set(".hero__fade", { opacity: 0, y: 18 });

      const timeline = gsap.timeline({ delay: 0.15 });
      timeline
        .to(targets, {
          yPercent: 0,
          duration: 1.05,
          ease: "expo.out",
          stagger: 0.085,
        })
        .to(
          ".hero__fade",
          { opacity: 1, y: 0, duration: 0.8, ease: "power3.out", stagger: 0.06 },
          "-=0.65",
        )
        .to(
          ".hero__note",
          { opacity: 1, duration: 0.7, ease: "power2.out", stagger: 0.12 },
          "-=0.45",
        )
        .fromTo(
          ".hero__note path",
          { strokeDasharray: 200, strokeDashoffset: 200 },
          { strokeDashoffset: 0, duration: 0.8, ease: "power2.out", stagger: 0.1 },
          "<",
        );

      // The headline drifts up a touch faster than the page as you scroll away.
      gsap.to(heading, {
        yPercent: -12,
        ease: "none",
        scrollTrigger: { trigger: root, start: "top top", end: "bottom top", scrub: 0.6 },
      });
    }, rootRef);

    return () => context.revert();
  }, []);

  useEffect(() => {
    const container = statsRef.current;
    if (!container || !stats) return;
    const context = gsap.context(() => {
      container.querySelectorAll<HTMLElement>("[data-count]").forEach((element) => {
        countUp(element, Number(element.dataset.count ?? 0));
      });
    }, statsRef);
    return () => context.revert();
  }, [stats]);

  return (
    <header className="hero" ref={rootRef} id="top">
      <div className="hero__eyebrow hero__fade">
        <span className="micro">ReplicaStake</span>
        <span className="micro">GenLayer · StudioNet</span>
        <span className="micro">Adjudication, not oracles</span>
      </div>

      <h1 ref={headingRef}>
        {LINES.map((line) => (
          <span className="line" key={line}>
            <span>{line}</span>
          </span>
        ))}
      </h1>

      <div className="hero__note hero__note--a">
        <svg width="52" height="30" viewBox="0 0 52 30" fill="none" aria-hidden>
          <path
            d="M2 27C10 12 24 3 50 3"
            stroke="var(--stamp-red)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M50 3l-8 1.5M50 3l-3.5 6"
            stroke="var(--stamp-red)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <span className="hand">roughly 70% of them</span>
      </div>

      <div className="hero__note hero__note--b">
        <span className="hand" style={{ transform: "rotate(3deg)" }}>
          peer review never runs the code
        </span>
      </div>

      <div className="hero__body">
        <div className="hero__fade">
          <p>
            An author stakes credits behind exactly one number from their paper, together
            with the protocol needed to get it. A replicator runs the experiment in public
            CI and posts the log. GenLayer validators then independently fetch that log and
            settle the bond.
          </p>
          <p style={{ marginTop: 14 }}>
            No oracle signs the answer. The contract itself reads the evidence and decides
            whether the run followed the protocol, what number it produced, and whether the
            gap is defensible — three judgments a deterministic chain cannot make.
          </p>
          <div className="hero__actions">
            <button type="button" className="btn btn--solid" onClick={onBrowse}>
              <span>open the registry</span>
            </button>
            <button type="button" className="btn" onClick={onRegister}>
              <span>stake a claim</span>
            </button>
          </div>
        </div>

        <div className="hero__stats hero__fade" ref={statsRef}>
          <div className="stat">
            <b data-count={stats?.claims ?? 0}>0</b>
            <span className="micro">claims bonded</span>
          </div>
          <div className="stat">
            <b data-count={stats?.reproduced ?? 0}>0</b>
            <span className="micro">reproduced</span>
          </div>
          <div className="stat">
            <b data-count={stats?.failed ?? 0}>0</b>
            <span className="micro">broken</span>
          </div>
          <div className="stat">
            <b data-count={stats?.locked ?? 0}>0</b>
            <span className="micro">RSC at risk</span>
          </div>
        </div>
      </div>
    </header>
  );
}
