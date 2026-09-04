import { studionet } from "genlayer-js/chains";

/**
 * StudioNet only. Bradbury and Asimov are deliberately not offered: this dApp
 * is built and demoed on the Studio network, which is gasless and therefore
 * lets anyone try the full stake/settle loop without a faucet round trip.
 */
export const CHAIN = studionet;
export const NETWORK_NAME = "studionet" as const;

export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ?? "").trim() as
  | `0x${string}`
  | "";

export const EXPLORER_URL = "https://genlayer-explorer.vercel.app";
export const STUDIO_URL = "https://studio.genlayer.com";

/** Internal ledger unit. StudioNet accounts hold 0 GEN, so stakes use credits. */
export const CREDIT_SYMBOL = "RSC";

export const BURNER_STORAGE_KEY = "replicastake.burner.v1";

export const isConfigured = CONTRACT_ADDRESS.startsWith("0x");
