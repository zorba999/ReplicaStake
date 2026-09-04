import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./contract";
import { isConfigured } from "./config";
import { logErr } from "./log";
import type { Balance, Claim, Stats } from "./types";

/**
 * Single source of truth for everything the page reads off-chain. Reads are
 * cheap and unauthenticated, so we just refetch after every write rather than
 * trying to patch local state to match consensus.
 */
export function useRegistry(address: string) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!isConfigured) {
      setLoading(false);
      setError(
        "No contract address configured. Run `npm run deploy:contract`, then restart the dev server.",
      );
      return;
    }
    try {
      const [nextStats, nextClaims] = await Promise.all([api.stats(), api.claims(0, 100)]);
      if (!mounted.current) return;
      setStats(nextStats);
      // Newest first: the contract appends, so the tail is the fresh end.
      setClaims([...nextClaims.items].reverse());
      setError("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (mounted.current) setError(message);
      logErr(`registry read failed: ${message}`);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!address || !isConfigured) {
      setBalance(null);
      return;
    }
    try {
      const next = await api.balance(address);
      if (mounted.current) setBalance(next);
    } catch {
      /* a missing balance is not worth shouting about */
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshBalance()]);
  }, [refresh, refreshBalance]);

  return { claims, stats, balance, loading, error, refresh, refreshBalance, refreshAll };
}
