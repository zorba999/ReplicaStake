import { useEffect, useRef, useState } from "react";

import { gsap } from "../anim/motion";
import { CHAIN, CREDIT_SYMBOL } from "../lib/config";
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
  const label = wallet.connecting
    ? "connecting…"
    : wallet.wrongNetwork
      ? "wrong network"
      : connected
        ? `${shortAddress(wallet.address)}${credits ? ` · ${credits} ${CREDIT_SYMBOL}` : ""}`
        : "connect";

  return (
    <div className="wallet-pill" ref={wrapRef}>
      <button
        type="button"
        className={
          wallet.wrongNetwork
            ? "btn btn--sm btn--warn"
            : connected
              ? "btn btn--sm"
              : "btn btn--sm btn--solid"
        }
        onClick={() => setOpen((value) => !value)}
        disabled={wallet.connecting}
      >
        <span>{label}</span>
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
                  // Close only on success: a failed connect must leave the
                  // menu open so its error is actually readable.
                  void wallet.connectBurner().then((ok) => ok && setOpen(false));
                }}
              >
                <b>Session key</b>
                <span>
                  Generated in your browser, kept in localStorage. Instant, no extension.
                </span>
              </button>

              {wallet.wallets.length === 0 && (
                <div className="wallet-option" style={{ cursor: "default", opacity: 0.7 }}>
                  <b>No EVM wallet detected</b>
                  <span>
                    Install MetaMask, Rabby, or any EIP-1193 wallet and reload — or just use
                    the session key above.
                  </span>
                </div>
              )}

              {wallet.wallets.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="wallet-option"
                  onClick={() => {
                    void wallet.connectInjected(option.id).then((ok) => ok && setOpen(false));
                  }}
                >
                  <b>
                    {option.icon && (
                      <img
                        src={option.icon}
                        alt=""
                        width={14}
                        height={14}
                        style={{ verticalAlign: "-2px", marginRight: 6 }}
                      />
                    )}
                    {option.name}
                  </b>
                  <span>
                    Adds {CHAIN.name} (chain {CHAIN.id}) and signs with your own account.
                  </span>
                </button>
              ))}
            </>
          )}

          {connected && (
            <>
              <p>
                Signing as <b>{shortAddress(wallet.address)}</b> via {wallet.walletName}.
              </p>

              {wallet.wrongNetwork && (
                <>
                  <div className="form__error">
                    Your wallet is on another network. StudioNet transactions will fail until
                    you switch.
                  </div>
                  <button
                    type="button"
                    className="btn btn--sm btn--solid"
                    onClick={() => void wallet.switchNetwork()}
                  >
                    <span>switch to {CHAIN.name}</span>
                  </button>
                </>
              )}

              {onFaucet && !wallet.wrongNetwork && (
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
