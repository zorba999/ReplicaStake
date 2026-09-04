import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

/** A live frame loop produces ~70 of these per second; a dead one produces 0-1. */
const MIN_FRAMES = 4;

export const EASE = "power3.out";
export const EASE_IO = "power2.inOut";

/**
 * Motion failsafe.
 *
 * Everything below animates from a hidden start state, so if the frame loop
 * never runs the page would sit blank forever. Some embedded webviews and
 * offscreen/composited-away contexts fire requestAnimationFrame once, or never,
 * which is exactly that failure. We count frames, and if too few arrive we flag
 * `no-motion` on <html>; the stylesheet then forces every start state to its
 * finished value and `reducedMotion()` starts reporting true, so all the
 * gsap.set() branches take over from the gsap.to() ones.
 */
if (typeof window !== "undefined") {
  let frames = 0;
  const tick = () => {
    frames += 1;
    if (frames < MIN_FRAMES) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const verdict = () => {
    if (frames >= MIN_FRAMES) return;
    document.documentElement.classList.add("no-motion");
    // CSS can restore layout, but not text: settle any counters that were
    // already mid-flight when we found out there is no frame loop.
    document.querySelectorAll<HTMLElement>("[data-count]").forEach((element) => {
      element.textContent = Number(element.dataset.count ?? 0).toLocaleString("en-US");
    });
  };

  // Checked twice: once for a loop that never starts, once for a loop that
  // emits a stray frame and then dies.
  window.setTimeout(verdict, 1200);
  window.setTimeout(verdict, 3200);
}

export const motionDisabled = () =>
  typeof document !== "undefined" &&
  document.documentElement.classList.contains("no-motion");

export const reducedMotion = () =>
  motionDisabled() ||
  (typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);

/**
 * Splits a string into per-word spans wrapped in per-line masks. We do this by
 * hand rather than pulling SplitText so the bundle stays honest and the markup
 * is predictable for the mask-reveal below.
 */
export function buildMaskedLines(container: HTMLElement, lines: string[]) {
  container.innerHTML = "";
  const targets: HTMLElement[] = [];
  lines.forEach((line) => {
    const mask = document.createElement("span");
    mask.className = "line";
    const inner = document.createElement("span");
    inner.textContent = line;
    mask.appendChild(inner);
    container.appendChild(mask);
    targets.push(inner);
  });
  return targets;
}

/** Standard entrance for anything tagged `.reveal` inside a section. */
export function revealOnScroll(scope: HTMLElement, selector = ".reveal") {
  const items = gsap.utils.toArray<HTMLElement>(selector, scope);
  if (!items.length) return;
  if (reducedMotion()) {
    gsap.set(items, { opacity: 1, y: 0 });
    return;
  }
  gsap.to(items, {
    opacity: 1,
    y: 0,
    duration: 0.9,
    ease: EASE,
    stagger: 0.07,
    scrollTrigger: {
      trigger: scope,
      start: "top 78%",
      once: true,
    },
  });
}

/** Counts a numeric element up when it scrolls into view. */
export function countUp(element: HTMLElement, to: number, suffix = "") {
  if (reducedMotion()) {
    element.textContent = `${to.toLocaleString("en-US")}${suffix}`;
    return;
  }
  const state = { value: 0 };
  const final = `${to.toLocaleString("en-US")}${suffix}`;
  const settle = () => {
    element.textContent = final;
  };
  // Show the truth first; the tween only makes it arrive prettily.
  settle();
  // …and if the frame loop turned out to be dead mid-count, put it back.
  window.setTimeout(() => {
    if (motionDisabled()) settle();
  }, 2200);
  gsap.to(state, {
    value: to,
    duration: 1.4,
    ease: "power2.out",
    scrollTrigger: { trigger: element, start: "top 88%", once: true },
    onUpdate: () => {
      element.textContent = `${Math.round(state.value).toLocaleString("en-US")}${suffix}`;
    },
    onComplete: settle,
  });
}
