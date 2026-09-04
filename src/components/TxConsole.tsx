import { useEffect, useRef, useState } from "react";

import { clock } from "../lib/format";
import { useLogLines } from "../lib/log";

export default function TxConsole({ busy }: { busy: boolean }) {
  const lines = useLogLines();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [lines]);

  if (!lines.length) return null;

  return (
    <div className="corner corner--bl">
      <div className="console">
        <button
          type="button"
          className="console__head"
          onClick={() => setOpen((value) => !value)}
          style={{ background: "none", border: "none", cursor: "pointer", width: "100%" }}
        >
          <span className={busy ? "pulse pulse--busy" : "pulse"} />
          <span>studionet log</span>
          <span style={{ marginLeft: "auto" }}>{open ? "—" : "+"}</span>
        </button>
        {open && (
          <div className="console__body" ref={bodyRef}>
            {lines.map((line) => (
              <div
                key={line.id}
                className={`console__line${line.level === "err" ? " is-err" : line.level === "ok" ? " is-ok" : ""}`}
              >
                <time>{clock(line.at)}</time>
                <span>{line.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
