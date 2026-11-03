"use client";
import { useCallback, useRef, useState } from "react";
// Synchronous submit lock. React state (`busy`) updates asynchronously, so two fast
// clicks both pass a `if (busy) return` check. A ref flips immediately, so only the
// first call ever runs. `run(fn, { keepLocked })` keeps the lock after success (use
// when the page navigates away) so a click during navigation cannot repeat the action.
export function useSubmitLock() {
  const ref = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, { keepLocked = false } = {}) => {
    if (ref.current) return undefined;
    ref.current = true; setBusy(true);
    let ok = false;
    try { const out = await fn(); ok = true; return out; }
    finally { if (!(ok && keepLocked)) { ref.current = false; setBusy(false); } }
  }, []);
  return { busy, run, locked: () => ref.current };
}
