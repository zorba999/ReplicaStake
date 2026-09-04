import { useEffect, useRef } from "react";

import { gsap, revealOnScroll, reducedMotion } from "../anim/motion";

const STEPS = [
  {
    title: "The author bonds one number",
    body:
      "Not a paper — one cell of one table. Claimed value, tolerance, repo URL pinned to a commit SHA, and the protocol written in plain language. The stake locks on registration.",
  },
  {
    title: "Anyone can audit the spec first",
    body:
      "A validator round reads the README against the declared protocol and scores how executable it is. A claim that no stranger could run tonight is visible as such before anyone wastes GPU hours on it.",
  },
  {
    title: "A replicator runs it in public CI",
    body:
      "Off-chain, where the GPUs are. The evidence has to be an immutable public artifact — a CI run, a pinned raw log, a metrics file — because the whole design rests on evidence the submitter cannot rewrite.",
  },
  {
    title: "Validators fetch the log and judge it",
    body:
      "Each validator independently pulls the same evidence, extracts the final number, and decides whether the protocol was followed. They compare the decision fields, not the prose. Disagreement rotates the leader instead of locking in a bad verdict.",
  },
  {
    title: "The verdict moves the money",
    body:
      "REPRODUCED returns the bond and marks the claim. FAILED sends 70% of the stake to the replicator. INVALID_ATTEMPT burns half the bond and leaves the claim untouched — that third verdict is what stops this from being a griefing machine.",
  },
];

export default function Mechanism() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const context = gsap.context(() => {
      revealOnScroll(root);

      if (reducedMotion()) return;

      gsap.utils.toArray<HTMLElement>(".mech__step", root).forEach((step) => {
        gsap.timeline({
          scrollTrigger: {
            trigger: step,
            start: "top 68%",
            end: "bottom 42%",
            onToggle: ({ isActive }) => step.classList.toggle("is-active", isActive),
          },
        });
      });
    }, rootRef);

    return () => context.revert();
  }, []);

  return (
    <section className="section" ref={rootRef} id="mechanism">
      <div className="section-head reveal">
        <h2>How a claim gets settled</h2>
        <span className="micro">fig. 01 — lifecycle</span>
      </div>

      <div className="mech">
        <div className="mech__steps reveal">
          {STEPS.map((step, index) => (
            <article className="mech__step" key={step.title}>
              <div className="idx">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </article>
          ))}
        </div>

        <aside className="mech__aside reveal">
          <h4>What the chain actually owns</h4>
          <dl>
            <dt>on-chain</dt>
            <dd>
              The claim, the stake, the evidence pointer, the consensus verdict and the
              settlement. Nothing else.
            </dd>
            <dt>off-chain</dt>
            <dd>
              The compute. GenLayer validators have no GPUs and never train anything — they
              adjudicate evidence that already exists.
            </dd>
            <dt>the honest limit</dt>
            <dd>
              A verdict is only as good as the evidence is hard to fake. That is why the
              contract wants CI runs and pinned raw artifacts, not pasted numbers.
            </dd>
            <dt>equivalence principle</dt>
            <dd>
              <code>gl.vm.run_nondet</code> with a custom validator: each node re-reads the
              log, then agreement is checked on the verdict, the NO-compliance boundary and
              the extracted value within a reading tolerance.
            </dd>
          </dl>
        </aside>
      </div>
    </section>
  );
}
