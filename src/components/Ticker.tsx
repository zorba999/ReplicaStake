import { useEffect, useRef } from "react";

import { gsap, reducedMotion } from "../anim/motion";

const ITEMS = [
  ["intelligent contract", "reads the log itself"],
  ["no oracle", "validators fetch the evidence"],
  ["equivalence principle", "run_nondet + tolerance"],
  ["verdicts", "reproduced · failed · invalid"],
  ["studionet", "gasless, 5 validators"],
  ["settlement", "70% of a broken stake to the replicator"],
];

export default function Ticker() {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || reducedMotion()) return;

    const context = gsap.context(() => {
      // The track holds the list twice, so wrapping at -50% is seamless.
      const tween = gsap.to(track, {
        xPercent: -50,
        duration: 34,
        ease: "none",
        repeat: -1,
      });
      const speedUp = () => gsap.to(tween, { timeScale: 0.25, duration: 0.5 });
      const speedDown = () => gsap.to(tween, { timeScale: 1, duration: 0.6 });
      track.addEventListener("pointerenter", speedUp);
      track.addEventListener("pointerleave", speedDown);
      return () => {
        track.removeEventListener("pointerenter", speedUp);
        track.removeEventListener("pointerleave", speedDown);
      };
    }, trackRef);

    return () => context.revert();
  }, []);

  const doubled = [...ITEMS, ...ITEMS];

  return (
    <div className="ticker" aria-hidden>
      <div className="ticker__track" ref={trackRef}>
        {doubled.map(([label, detail], index) => (
          <span key={`${label}-${index}`}>
            <i>◆</i> {label} — {detail}
          </span>
        ))}
      </div>
    </div>
  );
}
