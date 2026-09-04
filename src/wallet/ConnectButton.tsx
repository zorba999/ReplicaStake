import { useEffect, useRef, useState } from "react";

import { gsap } from "../anim/motion";
import { CREDIT_SYMBOL } from "../lib/config";
import { shortAddress } from "../lib/format";
import { logOk } from "../lib/log";
import { useWallet } from "./WalletContext";

interface Props {
  credits?: string;
  onFaucet?: () => void;
  faucetBusy?: boolean;
  faucetUsed?: boolean;
}

export default function ConnectButton({ credits, onFaucet, faucetBusy, faucetUsed }: Props) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !menuRef.current) return;
    gsap.fromTo(
      menuRef.current,
      { opacity: 0, y: -8 },
      { opacity: 1, y: 0, duration: 0.35, ease: "power3.out" },
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const connected = wallet.kind !== "none";

  return (
    <div className="wallet-pill" ref={wrapRef}>
      <button
        type="button"
        className={connected ? "btn btn--sm" : "btn btn--sm btn--solid"}
        onClick={() => setOpen((value) => !value)}
        disabled={wallet.connecting}
      >
        <span>
          {wallet.connecting
            ? "connecting…"
            : connected
              ? `${shortAddress(wallet.address)}${credits ? ` · ${credits} ${CREDIT_SYMBOL}` : ""}`
              : "connect"}
        </span>
      </button>

      {open && (
        <div className="wallet-menu" ref={menuRef}>
          {!connected && (
            <>
              <p>
                StudioNet is gasless, so a throwaway session key is enough to stake, submit
                and adjudicate. Nothing here is worth real money.
              </p>
              <button
                type="button"
                className="wallet-option"
                onClick={() => {
                  void wallet.connect("burner").then(() => setOpen(false));
                }}
              >
                <b>Session key</b>
                <span>
                  Generated in your browser, kept in localStorage. Instant, no extension.
                </span>
              </button>
              <button
                type="button"
                className="wallet-option"
                onClick={() => {
                  void wallet.connect("metamask").then(() => setOpen(false));
                }}
                disabled={!wallet.hasMetaMask}
              >
                <b>MetaMask</b>
                <span>
                  {wallet.hasMetaMask
                    ? "Adds StudioNet and installs the GenLayer snap so MetaMask can sign GenLayer calldata."
                    : "Not detected in this browser."}
                </span>
              </button>
            </>
          )}

          {connected && (
            <>
              <p>
                Signing as <b>{shortAddress(wallet.address)}</b> via{" "}
                {wallet.kind === "burner" ? "a browser session key" : "MetaMask"}.
              </p>
              {onFaucet && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={onFaucet}
                  disabled={faucetBusy || faucetUsed}
                >
                  <span>
                    {faucetUsed
                      ? "faucet already used"
                      : faucetBusy
                        ? "claiming…"
                        : `claim 10 000 ${CREDIT_SYMBOL}`}
                  </span>
                </button>
              )}
              {wallet.kind === "burner" && (
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => {
                    const key = wallet.exportBurnerKey();
                    if (key) {
                      void navigator.clipboard?.writeText(key);
                      logOk("session key copied to clipboard");
                    }
                  }}
                >
                  <span>copy session key</span>
                </button>
              )}
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  wallet.disconnect();
                  setOpen(false);
                }}
              >
                <span>disconnect</span>
              </button>
            </>
          )}

          {wallet.error && <div className="form__error">{wallet.error}</div>}
        </div>
      )}
    </div>
  );
}
