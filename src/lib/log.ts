import { useSyncExternalStore } from "react";

import type { LogLevel, LogLine } from "./types";

/**
 * A tiny pub/sub so any form can write to the transaction console without the
 * console having to live above it in the tree.
 */
const MAX_LINES = 60;

let lines: LogLine[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function log(text: string, level: LogLevel = "info") {
  lines = [...lines, { id: nextId++, at: Date.now(), level, text }].slice(-MAX_LINES);
  emit();
}

export const logOk = (text: string) => log(text, "ok");
export const logErr = (text: string) => log(text, "err");

export function clearLog() {
  lines = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => lines;

export function useLogLines() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
