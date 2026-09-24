import { useSyncExternalStore } from "react";
import { tellNobody } from "@/lib/mounted";
import { modKeyInBrowser, modKeyOnServer, type ModKey } from "@/lib/mod-key";

/** ⌘ or Ctrl in the browser, and `null` on the server. See `src/lib/mod-key.ts`. */
export function useModKey(): ModKey | null {
  return useSyncExternalStore(tellNobody, modKeyInBrowser, modKeyOnServer);
}
