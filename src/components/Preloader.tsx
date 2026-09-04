import { useEffect, useRef } from "react";

import { gsap, reducedMotion } from "../anim/motion";

const PHASES = [
  "calibrating paper",
  "reading studionet",
  "loading registry",
  "arming validators",
];

export default function Preloader({ onDone }: { onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Held in a ref so a parent re-render never restarts the intro timeline.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const numRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.body.classList.add("is-locked");

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      document.body.classList.remove("is-locked");
      if (rootRef.current) rootRef.current.style.display = "none";
      doneRef.current();
    };

    if (reducedMotion()) {
      finish();
      return;
    }

    // If the frame loop never starts, the intro would trap the page behind a
    // full-screen curtain. Release it either way.
    const failsafe = window.setTimeout(finish, 4000);

    const context = gsap.context(() => {
      const counter = { value: 0 };
      const timeline = gsap.timeline({
        onComplete: () => {
          window.clearTimeout(failsafe);
          finish();
        },
      });

      timeline
        .to(counter, {
          value: 100,
          duration: 1.85,
          ease: "power2.inOut",
          onUpdate: () => {
            const value = Math.round(counter.value);
            if (numRef.current) numRef.current.textContent = String(value).padStart(3, "0");
            if (labelRef.current) {
              const phase = PHASES[Math.min(PHASES.length - 1, Math.floor(value / 26))];
              if (labelRef.current.textContent !== phase) labelRef.current.textContent = phase;
            }
          },
        })
        .to(barRef.current, { scaleX: 1, duration: 1.85, ease: "power2.inOut" }, 0)
        .to([numRef.current, labelRef.current, barRef.current?.parentElement ?? null], {
          opacity: 0,
          y: -14,
          duration: 0.45,
          ease: "power2.in",
          stagger: 0.04,
        })
        .to(
          rootRef.current,
          { yPercent: -100, duration: 0.9, ease: "expo.inOut" },
          "-=0.15",
        )
        .set(rootRef.current, { display: "none" });
    }, rootRef);

    return () => {
      window.clearTimeout(failsafe);
      document.body.classList.remove("is-locked");
      context.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="preloader" ref={rootRef}>
      <div className="preloader__inner">
        <div className="preloader__num" ref={numRef}>
          000
        </div>
        <div className="micro preloader__label" ref={labelRef}>
          calibrating paper
        </div>
        <div className="preloader__bar">
          <i ref={barRef} />
        </div>
      </div>
    </div>
  );
}
