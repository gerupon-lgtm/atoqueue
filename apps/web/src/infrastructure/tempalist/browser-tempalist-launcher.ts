import { buildTempalistUrl } from "../../../../../packages/domain/src";
import type { TempalistLaunchPort } from "../../application/tempalist-transfer-service";

/** Provisional navigation adapter; Android/iOS PWA capture requires device testing. */
export function createBrowserTempalistLauncher(
  location: Pick<Location, "assign"> = window.location,
): TempalistLaunchPort {
  return {
    open(url) {
      try {
        const prefix = "https://tempalist.sikumilab.com/#create=";
        if (!url.startsWith(prefix) || url.length > 8000) throw new Error();
        const encoded = url.slice(prefix.length);
        if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
        const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
        const payload: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(binary, (char) => char.charCodeAt(0)),
          ),
        );
        if (buildTempalistUrl(payload) !== url) throw new Error();
      } catch {
        throw new Error("テンパリストの起動URLが不正です。");
      }
      location.assign(url);
    },
  };
}
