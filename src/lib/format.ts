export const shortAddress = (address?: string) =>
  address && address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : (address ?? "");

export const shortSha = (sha?: string) => (sha ? sha.slice(0, 7) : "");

export const num = (value?: string | number) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US") : "0";
};

export const clock = (at: number) =>
  new Date(at).toLocaleTimeString("en-GB", { hour12: false }).slice(0, 8);

export const pad = (value: number, size = 4) => String(Math.round(value)).padStart(size, "0");

/** A stable, human-typable id: `owt-124m-mtn18` style. */
export function slugId(prefix: string, seed: string) {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  const salt = Date.now().toString(36).slice(-5);
  return `${prefix}-${base || "claim"}-${salt}`.slice(0, 64);
}

export const verdictClass = (verdict: string) =>
  `stamp stamp--${verdict.toLowerCase() || "pending"}`;

export const statusClass = (status: string) => `badge badge--${status.toLowerCase()}`;
