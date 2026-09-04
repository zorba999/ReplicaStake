import { useEffect, useRef } from "react";

import { gsap, reducedMotion, revealOnScroll } from "../anim/motion";

const VALIDATORS = [
  { id: "v1", x: 560, y: 70, vote: "agree" },
  { id: "v2", x: 665, y: 150, vote: "agree" },
  { id: "v3", x: 665, y: 250, vote: "disagree" },
  { id: "v4", x: 560, y: 330, vote: "agree" },
] as const;

const LEADER = { x: 400, y: 200 };
const EVIDENCE = { x: 130, y: 200 };

/**
 * A plotted diagram of one adjudication round: the leader proposes, four
 * validators independently re-fetch the same evidence, and the majority decides.
 * It loops, because the point is that this happens on every transaction.
 */
export default function Consensus() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const context = gsap.context(() => {
      revealOnScroll(root);
      if (reducedMotion()) {
        gsap.set(".cs-node, .cs-vote, .cs-verdict", { opacity: 1, scale: 1, rotate: -9 });
        gsap.set(".cs-wire", { strokeDashoffset: 0 });
        return;
      }

      gsap.set(".cs-wire", { strokeDasharray: 520, strokeDashoffset: 520 });
      gsap.set(".cs-node, .cs-vote, .cs-verdict, .cs-packet", { opacity: 0 });
      gsap.set(".cs-node", { transformOrigin: "center", scale: 0.4 });
      gsap.set(".cs-verdict", { transformOrigin: "center", scale: 1.9, rotate: -20 });

      const timeline = gsap.timeline({
        repeat: -1,
        repeatDelay: 1.4,
        scrollTrigger: { trigger: root, start: "top 72%" },
      });

      timeline
        .to(".cs-evidence", { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" })
        .to(".cs-leader", { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)" }, "+=0.15")
        .to(".cs-wire-leader", { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, "<")
        .to(
          ".cs-validator",
          { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)", stagger: 0.08 },
          "+=0.1",
        )
        .to(
          ".cs-wire-validator",
          { strokeDashoffset: 0, duration: 0.75, ease: "power2.inOut", stagger: 0.08 },
          "<",
        )
        // Each validator pulls the evidence for itself — that is the whole argument.
        .to(
          ".cs-packet",
          {
            opacity: 1,
            duration: 0.2,
            stagger: 0.09,
            onStart: () => {
              gsap.utils.toArray<SVGElement>(".cs-packet").forEach((packet, index) => {
                gsap.fromTo(
                  packet,
                  { attr: { cx: EVIDENCE.x, cy: EVIDENCE.y } },
                  {
                    attr: { cx: VALIDATORS[index].x, cy: VALIDATORS[index].y },
                    duration: 0.85,
                    delay: index * 0.09,
                    ease: "power2.inOut",
                  },
                );
              });
            },
          },
          "-=0.3",
        )
        .to(".cs-packet", { opacity: 0, duration: 0.25 }, "+=0.6")
        .to(".cs-vote", { opacity: 1, duration: 0.3, stagger: 0.1 }, "-=0.1")
        .to(".cs-verdict", {
          opacity: 0.92,
          scale: 1,
          rotate: -9,
          duration: 0.5,
          ease: "back.out(3)",
        })
        .to({}, { duration: 1.5 })
        .to(".cs-node, .cs-vote, .cs-verdict", {
          opacity: 0,
          duration: 0.4,
          ease: "power2.in",
        })
        .to(".cs-wire", { strokeDashoffset: 520, duration: 0.4, ease: "power2.in" }, "<")
        .set(".cs-node", { scale: 0.4 })
        .set(".cs-verdict", { scale: 1.9, rotate: -20 });
    }, rootRef);

    return () => context.revert();
  }, []);

  return (
    <section className="section" ref={rootRef} id="consensus">
      <div className="section-head reveal">
        <h2>One round, five opinions</h2>
        <span className="micro">fig. 02 — optimistic democracy</span>
      </div>

      <div className="consensus reveal">
        <div className="consensus__stage">
          <svg viewBox="0 0 800 400" role="img" aria-label="Diagram of one consensus round">
            <g className="cs-axis">
              <path d="M0 200H800" />
              <path d="M400 0V400" />
            </g>

            <path
              className="cs-wire cs-wire-leader"
              d={`M${EVIDENCE.x + 58} ${EVIDENCE.y}H${LEADER.x - 34}`}
            />
            {VALIDATORS.map((validator) => (
              <path
                key={`w-${validator.id}`}
                className="cs-wire cs-wire-validator"
                d={`M${LEADER.x + 34} ${LEADER.y}C${LEADER.x + 120} ${LEADER.y}, ${validator.x - 90} ${validator.y}, ${validator.x - 26} ${validator.y}`}
              />
            ))}

            <g className="cs-node cs-evidence">
              <rect
                className="cs-paper"
                x={EVIDENCE.x - 58}
                y={EVIDENCE.y - 46}
                width="116"
                height="92"
              />
              <g className="cs-lines">
                <path d={`M${EVIDENCE.x - 40} ${EVIDENCE.y - 22}h80`} />
                <path d={`M${EVIDENCE.x - 40} ${EVIDENCE.y - 6}h80`} />
                <path d={`M${EVIDENCE.x - 40} ${EVIDENCE.y + 10}h52`} />
              </g>
              <text className="cs-label" x={EVIDENCE.x} y={EVIDENCE.y + 36}>
                CI LOG
              </text>
            </g>

            <g className="cs-node cs-leader">
              <circle className="cs-blue" cx={LEADER.x} cy={LEADER.y} r="32" />
              <text className="cs-label cs-label--onblue" x={LEADER.x} y={LEADER.y + 4}>
                LEAD
              </text>
            </g>

            {VALIDATORS.map((validator) => (
              <g className="cs-node cs-validator" key={validator.id}>
                <circle className="cs-paper" cx={validator.x} cy={validator.y} r="24" />
                <text className="cs-label" x={validator.x} y={validator.y + 4}>
                  {validator.id.toUpperCase()}
                </text>
              </g>
            ))}

            {VALIDATORS.map((validator) => (
              <circle
                key={`p-${validator.id}`}
                className="cs-packet"
                cx={EVIDENCE.x}
                cy={EVIDENCE.y}
                r="3.5"
              />
            ))}

            {VALIDATORS.map((validator) => (
              <text
                key={`vote-${validator.id}`}
                className={`cs-vote ${validator.vote === "agree" ? "is-agree" : "is-disagree"}`}
                x={validator.x + 36}
                y={validator.y + 4}
              >
                {validator.vote === "agree" ? "AGREE" : "DISAGREE"}
              </text>
            ))}

            {/* Positioned with plain coordinates, not a transform attribute:
                gsap and the no-motion stylesheet both own `transform` here. */}
            <g className="cs-verdict">
              <rect x="168" y="312" width="216" height="44" rx="3" />
              <text x="276" y="340">
                REPRODUCED
              </text>
            </g>
          </svg>
        </div>

        <div className="consensus__legend">
          <div>
            <span className="dot dot--leader" />
            <span className="micro">leader proposes the receipt</span>
          </div>
          <div>
            <span className="dot dot--agree" />
            <span className="micro">validator re-fetched and agreed</span>
          </div>
          <div>
            <span className="dot dot--disagree" />
            <span className="micro">disagreement rotates the leader</span>
          </div>
          <div>
            <span className="dot" />
            <span className="micro">majority writes the verdict to storage</span>
          </div>
        </div>
      </div>
    </section>
  );
}
