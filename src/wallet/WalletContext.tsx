import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createAccount, createClient, generatePrivateKey } from "genlayer-js";

import { BURNER_STORAGE_KEY, CHAIN } from "../lib/config";
import {
  CHAIN_ID_HEX,
  describeWalletError,
  ensureChain,
  getChainId,
  listProviders,
  startProviderDiscovery,
  type EthereumProvider,
  type WalletOption,
} from "./providers";

export type WalletKind = "none" | "burner" | "injected";

interface WalletState {
  kind: WalletKind;
  address: string;
  client: unknown | null;
  connecting: boolean;
  error: string;
  wallets: WalletOption[];
  walletName: string;
  wrongNetwork: boolean;
  /** Resolves true only when the wallet is actually connected. */
  connectBurner: () => Promise<boolean>;
  connectInjected: (id?: string) => Promise<boolean>;
  switchNetwork: () => Promise<void>;
  disconnect: () => void;
  exportBurnerKey: () => string | null;
}

const WalletContext = createContext<WalletState | null>(null);

const SESSION_KEY = "replicastake.wallet.kind";
const SESSION_WALLET = "replicastake.wallet.id";

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

const remember = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};

const forget = (key: string) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<WalletKind>("none");
  const [address, setAddress] = useState("");
  const [client, setClient] = useState<unknown | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [walletName, setWalletName] = useState("");
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const providerRef = useRef<EthereumProvider | null>(null);

  useEffect(() => startProviderDiscovery(setWallets), []);

  useEffect(() => {
    setWallets(listProviders());
  }, []);

  const connectBurner = useCallback(async (): Promise<boolean> => {
    setConnecting(true);
    setError("");
    try {
      const account = createAccount(loadBurnerKey());
      setClient(createClient({ chain: CHAIN, account }));
      setAddress(account.address);
      setWalletName("Session key");
      setWrongNetwork(false);
      providerRef.current = null;
      setKind("burner");
      remember(SESSION_KEY, "burner");
      return true;
    } catch (caught) {
      setError(describeWalletError(caught));
      return false;
    } finally {
      setConnecting(false);
    }
  }, []);

  const attach = useCallback(async (option: WalletOption) => {
    const provider = option.provider;

    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const account = accounts?.[0];
    if (!account) throw new Error("Your wallet returned no account.");

    // The GenLayer snap that the SDK's own connect() installs is only needed by
    // its snap-based signing client. Writes here go out as a plain
    // eth_sendTransaction to the consensus contract, so requiring the snap
    // would lock out every non-MetaMask EVM wallet for nothing.
    await ensureChain(provider);

    const next = createClient({
      chain: CHAIN,
      account: account as `0x${string}`,
      provider,
    });

    providerRef.current = provider;
    setClient(next);
    setAddress(account);
    setWalletName(option.name);
    setWrongNetwork(false);
    setKind("injected");
    remember(SESSION_KEY, "injected");
    remember(SESSION_WALLET, option.id);
  }, []);

  const connectInjected = useCallback(
    async (id?: string): Promise<boolean> => {
      setConnecting(true);
      setError("");
      try {
        const available = listProviders();
        if (available.length === 0) {
          throw new Error(
            "No EVM wallet detected in this browser. Install MetaMask (or any EIP-1193 wallet), or use the session key.",
          );
        }
        const option = (id && available.find((entry) => entry.id === id)) || available[0];
        await attach(option);
        return true;
      } catch (caught) {
        setError(describeWalletError(caught));
        return false;
      } finally {
        setConnecting(false);
      }
    },
    [attach],
  );

  const switchNetwork = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider) return;
    setError("");
    try {
      await ensureChain(provider);
      setWrongNetwork(false);
    } catch (caught) {
      setError(describeWalletError(caught));
    }
  }, []);

  const disconnect = useCallback(() => {
    providerRef.current = null;
    setClient(null);
    setAddress("");
    setWalletName("");
    setWrongNetwork(false);
    setKind("none");
    setError("");
    forget(SESSION_KEY);
    forget(SESSION_WALLET);
  }, []);

  const exportBurnerKey = useCallback(() => {
    try {
      return localStorage.getItem(BURNER_STORAGE_KEY);
    } catch {
      return null;
    }
  }, []);

  // A session key costs nothing to restore. An injected wallet is only restored
  // when it still reports an authorised account, so no popup is triggered.
  useEffect(() => {
    let stored: string | null = null;
    let storedWallet: string | null = null;
    try {
      stored = sessionStorage.getItem(SESSION_KEY);
      storedWallet = sessionStorage.getItem(SESSION_WALLET);
    } catch {
      return;
    }

    if (stored === "burner") {
      void connectBurner();
      return;
    }
    if (stored !== "injected") return;

    let cancelled = false;
    const restore = async () => {
      const option =
        listProviders().find((entry) => entry.id === storedWallet) ?? listProviders()[0];
      if (!option) return;
      try {
        const accounts = (await option.provider.request({ method: "eth_accounts" })) as string[];
        if (cancelled || !accounts?.length) return;
        await attach(option);
      } catch {
        /* the user will reconnect by hand */
      }
    };
    // Give EIP-6963 announcements a tick to land before we look for the wallet.
    const timer = window.setTimeout(restore, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connectBurner, attach]);

  // Follow the wallet instead of silently signing as someone else, or on a
  // chain where the consensus contract does not exist.
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider?.on || kind !== "injected") return;

    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as string[];
      if (!accounts?.length) disconnect();
      else setAddress(accounts[0]);
    };
    const onChain = (...args: never[]) => {
      const chainId = args[0] as unknown as string;
      setWrongNetwork(chainId?.toLowerCase() !== CHAIN_ID_HEX);
    };

    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    void getChainId(provider)
      .then((chainId) => setWrongNetwork(chainId?.toLowerCase() !== CHAIN_ID_HEX))
      .catch(() => {});

    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [kind, address, disconnect]);

  const value = useMemo<WalletState>(
    () => ({
      kind,
      address,
      client,
      connecting,
      error,
      wallets,
      walletName,
      wrongNetwork,
      connectBurner,
      connectInjected,
      switchNetwork,
      disconnect,
      exportBurnerKey,
    }),
    [
      kind,
      address,
      client,
      connecting,
      error,
      wallets,
      walletName,
      wrongNetwork,
      connectBurner,
      connectInjected,
      switchNetwork,
      disconnect,
      exportBurnerKey,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside <WalletProvider>");
  return context;
}
