import type { RegionResponse } from "./types";
import { requestWindow, type View } from "./viewport"; // eslint-disable-line @typescript-eslint/no-unused-vars

export interface RegionLoaderOptions {
  api: { region(chrom: string, start: number, end: number, signal?: AbortSignal): Promise<RegionResponse> };
  chrom: string;
  chromLen: number;
  /** Called with the answer and the window that was requested (API coordinates). */
  onData: (data: RegionResponse, window: { start: number; end: number }) => void;
  onError?: (err: unknown) => void;
  debounceMs?: number; // default 200
  grid?: number;       // default 500 (passed to requestWindow)
}

export interface RegionLoader {
  /** Tell the loader where the view is now. Call it on every pan or zoom. */
  setView(view: View): void;
  /** Stop everything: drop a pending request, abort an in-flight one, ignore its answer. */
  cancel(): void;
}

/**
 * Loads /regions data for the current view without flooding the server.
 *
 *  - Debounce: only after setView has not been called for `debounceMs` does a request go out
 *    (each new setView restarts the wait). Use setTimeout / clearTimeout.
 *  - The window to request is requestWindow(view, chromLen, grid).
 *  - If that window equals the window of the latest request (still loading or already loaded), do
 *    nothing: small moves reuse what is there.
 *  - Otherwise abort the previous request's AbortController, create a new one, and call
 *    api.region(chrom, start, end, signal).
 *  - Latest wins: give every request an increasing id, and ignore the result or the failure of any
 *    request that is no longer the latest, even if the API ignores the abort.
 *  - On success of the latest request call onData(data, window).
 *  - On failure of the latest request: forget the window (so it can be retried), and call onError,
 *    except for an AbortError (error.name === "AbortError"), which is not an error.
 *  - cancel(): clear the timer, abort the in-flight request, make its answer count as stale, and
 *    forget the window.
 */
export function createRegionLoader(options: RegionLoaderOptions): RegionLoader {
   const debounceMs = options.debounceMs ?? 200;
   const grid = options.grid ?? 500;

   let timer: ReturnType<typeof setTimeout> | undefined;
   let controller: AbortController | undefined;
   let latestRequestId = 0;

   let lastWindow: { start: number; end: number } | undefined;

   return {
    setView(view: View): void {
      if (timer !== undefined) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = undefined;

        const window = requestWindow(view, options.chromLen, grid);

        // reuse current window if already requested or loaded
        if (lastWindow !== undefined && lastWindow.start === window.start && lastWindow.end == window.end){
          return;
        }

        // stop prev request if still running
        if (controller !== undefined) {
          controller.abort();
        }

        // make every older request stale
        const requestId = ++latestRequestId;

        // remember new window, even while loading
        lastWindow = window;

        const requestController = new AbortController();
        controller = requestController;

        // fetch data for requested chromosome window
        void options.api.region(
          options.chrom,
          window.start,
          window.end,
          requestController.signal
        ).then((data) => {
          // ignore response from older request
          if (requestId !== latestRequestId) {
            return;
          }

          // latest request succeeded
          options.onData(data, window);
        }).catch((err: unknown) => {
          if (requestId !== latestRequestId) {
            return;
          }

          // aborting a request is expected, not a reportable error
          if (typeof err === "object" && err !== null && "name" in err && err.name === "AbortError") {
            return;
          }

          // allow this window to be requested again
          lastWindow = undefined

          options.onError?.(err);
        }).finally(() => {
          // clear controller only if it still belongs to this request
          if (controller === requestController) {
            controller = undefined;
          }
        });
      }, debounceMs);
    },

    cancel(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }

      latestRequestId++;

      if (controller !== undefined) {
        controller.abort();
        controller = undefined;
      }

      // forget window so it can be requested again
      lastWindow = undefined;
    },
  };
}
