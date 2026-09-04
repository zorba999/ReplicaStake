import { CHAIN } from "../lib/config";

export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isBraveWallet?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: EthereumProvider[];
}

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: EthereumProvider;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export const CHAIN_ID_HEX = `0x${CHAIN.id.toString(16)}` as const;

const CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: CHAIN.name,
  rpcUrls: [...CHAIN.rpcUrls.default.http],
  nativeCurrency: CHAIN.nativeCurrency,
  blockExplorerUrls: CHAIN.blockExplorers?.default.url
    ? [CHAIN.blockExplorers.default.url]
    : undefined,
};

// ---------------------------------------------------------------- discovery --

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EthereumProvider;
}

const announced = new Map<string, WalletOption>();
let discoveryStarted = false;

function legacyName(provider: EthereumProvider): string {
  if (provider.isRabby) return "Rabby";
  if (provider.isBraveWallet) return "Brave Wallet";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

/**
 * EIP-6963 discovery. Injecting a single `window.ethereum` is a race that the
 * last extension to load wins, which is why "connect my wallet" fails so often
 * when more than one is installed. Wallets that implement 6963 announce
 * themselves instead, so we ask, then fall back to whatever is on `window`.
 */
export function startProviderDiscovery(onChange: (wallets: WalletOption[]) => void) {
  if (typeof window === "undefined") return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    if (!detail?.provider || !detail.info) return;
    const id = detail.info.rdns || detail.info.uuid;
    if (announced.has(id)) return;
    announced.set(id, {
      id,
      name: detail.info.name,
      icon: detail.info.icon,
      provider: detail.provider,
    });
    onChange(listProviders());
  };

  window.addEventListener("eip6963:announceProvider", handler);
  if (!discoveryStarted) discoveryStarted = true;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  onChange(listProviders());

  return () => window.removeEventListener("eip6963:announceProvider", handler);
}

export function listProviders(): WalletOption[] {
  const wallets = [...announced.values()];
  if (wallets.length > 0) return wallets;

  // No 6963 announcements: fall back to the legacy injected object, including
  // the `providers` array that some multi-wallet setups expose.
  const injected = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!injected) return [];
  if (Array.isArray(injected.providers) && injected.providers.length > 0) {
    return injected.providers.map((provider, index) => ({
      id: `injected-${index}`,
      name: legacyName(provider),
      provider,
    }));
  }
  return [{ id: "injected", name: legacyName(injected), provider: injected }];
}

// ------------------------------------------------------------------- errors --

function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.code === "number") return record.code;
  const data = record.data as Record<string, unknown> | undefined;
  if (data && typeof data.originalError === "object") {
    const original = data.originalError as Record<string, unknown>;
    if (typeof original.code === "number") return original.code;
  }
  if (typeof data?.code === "number") return data.code;
  const cause = record.cause as Record<string, unknown> | undefined;
  if (cause && typeof cause.code === "number") return cause.code;
  return undefined;
}

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  for (const key of ["shortMessage", "message", "details", "reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const data = record.data as Record<string, unknown> | undefined;
  if (typeof data?.message === "string") return data.message;
  const cause = record.cause as Record<string, unknown> | undefined;
  if (typeof cause?.message === "string") return cause.message;
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") return json.slice(0, 200);
  } catch {
    /* circular */
  }
  return "";
}

/**
 * Wallets reject with plain `{ code, message }` objects, not Error instances,
 * so `String(err)` yields "[object Object]". Read the EIP-1193 code first and
 * fall back to whatever message-shaped field the wallet actually populated.
 */
export function describeWalletError(error: unknown): string {
  const code = errorCode(error);
  const message = rawMessage(error);

  switch (code) {
    case 4001:
      return "You rejected the request in your wallet.";
    case 4100:
      return "Your wallet has not authorised this account. Unlock it and try again.";
    case 4902:
      return `${CHAIN.name} is not in your wallet yet, and it refused to add it automatically. Add it manually: RPC ${CHAIN.rpcUrls.default.http[0]}, chain ID ${CHAIN.id}, symbol ${CHAIN.nativeCurrency.symbol}.`;
    case -32002:
      return "Your wallet already has a pending request. Open the extension and finish or dismiss it.";
    case -32601:
      return "Your wallet does not support this method. Try MetaMask, or use the session key instead.";
    default:
      break;
  }

  if (/user rejected|user denied|rejected the request/i.test(message)) {
    return "You rejected the request in your wallet.";
  }
  if (/already pending|already processing/i.test(message)) {
    return "Your wallet already has a pending request. Open the extension and finish it.";
  }
  if (/chain id.*does not match|chainid.*mismatch/i.test(message)) {
    return `Your wallet could not verify the RPC. ${CHAIN.rpcUrls.default.http[0]} should report chain ID ${CHAIN.id}.`;
  }
  return message || "Your wallet refused the request without giving a reason.";
}

// -------------------------------------------------------------- chain switch --

export async function getChainId(provider: EthereumProvider): Promise<string> {
  return (await provider.request({ method: "eth_chainId" })) as string;
}

/**
 * Switch first, add only if the wallet says it does not know the chain. Doing
 * it the other way round makes wallets that already have the network throw a
 * duplicate-chain error instead of just switching.
 */
export async function ensureChain(provider: EthereumProvider): Promise<void> {
  const current = await getChainId(provider);
  if (current?.toLowerCase() === CHAIN_ID_HEX) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = errorCode(error);
    const message = rawMessage(error);
    const unknownChain =
      code === 4902 ||
      code === -32603 ||
      /unrecognized chain|not added|add.*chain/i.test(message);
    if (!unknownChain) throw error;

    await provider.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS] });

    // Most wallets switch as part of adding; the ones that do not need a nudge.
    const afterAdd = await getChainId(provider);
    if (afterAdd?.toLowerCase() !== CHAIN_ID_HEX) {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
    }
  }
}
