import { useEffect, useRef } from "react";

import { gsap, reducedMotion } from "../anim/motion";

/**
 * The millimetre paper the whole site sits on. It drifts slowly against the
 * scroll and leans a few pixels toward the cursor, which is what stops a flat
 * CSS grid from reading as wallpaper.
 */
export default function PaperGrid() {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || reducedMotion()) return;

    const context = gsap.context(() => {
      const toX = gsap.quickTo(grid, "x", { duration: 1.4, ease: "power3.out" });
      const toY = gsap.quickTo(grid, "y", { duration: 1.4, ease: "power3.out" });

      let scrollOffset = 0;
      let pointerX = 0;
      let pointerY = 0;

      const apply = () => {
        toX(pointerX);
        toY(pointerY + scrollOffset);
      };

      const onScroll = () => {
        // The bold 40px rules make a slow drift legible without dizzying anyone.
        scrollOffset = (window.scrollY % 40) * -0.5;
        apply();
      };

      const onPointer = (event: PointerEvent) => {
        pointerX = (event.clientX / window.innerWidth - 0.5) * -18;
        pointerY = (event.clientY / window.innerHeight - 0.5) * -18;
        apply();
      };

      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("pointermove", onPointer, { passive: true });

      return () => {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("pointermove", onPointer);
      };
    });

    return () => context.revert();
  }, []);

  return (
    <>
      <div className="paper-grid" ref={gridRef} aria-hidden />
      <div className="paper-vignette" aria-hidden />
      <div className="paper-noise" aria-hidden />
    </>
  );
}
