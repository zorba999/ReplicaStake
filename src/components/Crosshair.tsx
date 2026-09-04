import { useEffect, useRef } from "react";

import { gsap, reducedMotion } from "../anim/motion";
import { pad } from "../lib/format";

/**
 * A drafting-table cursor: two hairlines plus a live coordinate readout in the
 * top-left corner, the way a plotter reports where the pen is.
 */
export default function Crosshair() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const xRef = useRef<HTMLSpanElement>(null);
  const yRef = useRef<HTMLSpanElement>(null);
  const readXRef = useRef<HTMLSpanElement>(null);
  const readYRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const vertical = xRef.current;
    const horizontal = yRef.current;
    if (!wrap || !vertical || !horizontal) return;

    // Touch devices have no cursor to track, and reduced motion means no chase.
    if (reducedMotion() || window.matchMedia("(hover: none)").matches) return;

    const context = gsap.context(() => {
      const toX = gsap.quickTo(vertical, "x", { duration: 0.5, ease: "power3.out" });
      const toY = gsap.quickTo(horizontal, "y", { duration: 0.5, ease: "power3.out" });
      let shown = false;

      const onMove = (event: PointerEvent) => {
        if (!shown) {
          shown = true;
          gsap.to(wrap, { opacity: 1, duration: 0.6 });
        }
        toX(event.clientX);
        toY(event.clientY);
        if (readXRef.current) readXRef.current.textContent = pad(event.clientX);
        if (readYRef.current) readYRef.current.textContent = pad(event.clientY);
      };

      const onLeave = () => {
        shown = false;
        gsap.to(wrap, { opacity: 0, duration: 0.4 });
      };

      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);

      return () => {
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerleave", onLeave);
      };
    });

    return () => context.revert();
  }, []);

  return (
    <>
      <div className="crosshair" ref={wrapRef} aria-hidden>
        <span className="cx" ref={xRef} />
        <span className="cy" ref={yRef} />
      </div>
      <div className="corner corner--tl" aria-hidden>
        <div className="readout">
          <div>
            x:<span ref={readXRef}>0000</span>
          </div>
          <div>
            y:<span ref={readYRef}>0000</span>
          </div>
        </div>
      </div>
    </>
  );
}
