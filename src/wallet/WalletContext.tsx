import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createAccount, createClient, generatePrivateKey } from "genlayer-js";

import { BURNER_STORAGE_KEY, CHAIN, NETWORK_NAME } from "../lib/config";

export type WalletKind = "none" | "burner" | "metamask";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

interface WalletState {
  kind: WalletKind;
  address: string;
  client: unknown | null;
  connecting: boolean;
  error: string;
  hasMetaMask: boolean;
  connect: (kind: Exclude<WalletKind, "none">) => Promise<void>;
  disconnect: () => void;
  exportBurnerKey: () => string | null;
  resetBurner: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

const SESSION_KEY = "replicastake.wallet.kind";

function loadBurnerKey(): `0x${string}` {
  try {
    const stored = localStorage.getItem(BURNER_STORAGE_KEY);
    if (stored && /^0x[0-9a-fA-F]{64}$/.test(stored)) return stored as `0x${string}`;
  } catch {
    /* private mode — fall through to an in-memory key */
  }
  const fresh = generatePrivateKey();
  try {
    localStorage.setItem(BURNER_STORAGE_KEY, fresh);
  } catch {
    /* not persistable; the key lives for this page load only */
  }
  return fresh;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<WalletKind>("none");
  const [address, setAddress] = useState("");
  const [client, setClient] = useState<unknown | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [hasMetaMask, setHasMetaMask] = useState(false);

  useEffect(() => {
    setHasMetaMask(Boolean(window.ethereum));
  }, []);

  const connectBurner = useCallback(async () => {
    const account = createAccount(loadBurnerKey());
    const next = createClient({ chain: CHAIN, account });
    setClient(next);
    setAddress(account.address);
    setKind("burner");
    try {
      sessionStorage.setItem(SESSION_KEY, "burner");
    } catch {
      /* ignore */
    }
  }, []);

  const connectMetaMask = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      throw new Error("MetaMask was not detected in this browser.");
    }
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const account = accounts?.[0];
    if (!account) throw new Error("MetaMask returned no account.");

    const next = createClient({ chain: CHAIN, account: account as `0x${string}`, provider });
    // Adds/switches the StudioNet chain and installs the GenLayer snap, which
    // MetaMask needs in order to sign GenLayer's calldata format.
    await (next as unknown as { connect: (n: string) => Promise<void> }).connect(NETWORK_NAME);

    setClient(next);
    setAddress(account);
    setKind("metamask");
    try {
      sessionStorage.setItem(SESSION_KEY, "metamask");
    } catch {
      /* ignore */
    }
  }, []);

  const connect = useCallback(
    async (target: Exclude<WalletKind, "none">) => {
      setConnecting(true);
      setError("");
      try {
        if (target === "burner") await connectBurner();
        else await connectMetaMask();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(
          /snap/i.test(message)
            ? "MetaMask refused the GenLayer snap. Approve it in the MetaMask popup, or use the session key instead."
            : message,
        );
      } finally {
        setConnecting(false);
      }
    },
    [connectBurner, connectMetaMask],
  );

  const disconnect = useCallback(() => {
    setClient(null);
    setAddress("");
    setKind("none");
    setError("");
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const exportBurnerKey = useCallback(() => {
    try {
      return localStorage.getItem(BURNER_STORAGE_KEY);
    } catch {
      return null;
    }
  }, []);

  const resetBurner = useCallback(() => {
    try {
      localStorage.removeItem(BURNER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    disconnect();
  }, [disconnect]);

  // A session key costs nothing to restore, so bring it back on reload.
  // MetaMask is deliberately not auto-reconnected: that needs a user gesture.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(SESSION_KEY);
    } catch {
      stored = null;
    }
    if (stored === "burner") void connectBurner();
  }, [connectBurner]);

  // Follow account switches in MetaMask instead of silently signing as someone else.
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on || kind !== "metamask") return;
    const handler = (...args: never[]) => {
      const accounts = args[0] as unknown as string[];
      if (!accounts?.length) disconnect();
      else void connectMetaMask();
    };
    provider.on("accountsChanged", handler);
    return () => provider.removeListener?.("accountsChanged", handler);
  }, [kind, connectMetaMask, disconnect]);

  const value = useMemo<WalletState>(
    () => ({
      kind,
      address,
      client,
      connecting,
      error,
      hasMetaMask,
      connect,
      disconnect,
      exportBurnerKey,
      resetBurner,
    }),
    [
      kind,
      address,
      client,
      connecting,
      error,
      hasMetaMask,
      connect,
      disconnect,
      exportBurnerKey,
      resetBurner,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside <WalletProvider>");
  return context;
}
