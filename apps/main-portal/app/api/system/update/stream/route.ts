import { readUpdateState, subscribeUpdateState } from "@/app/lib/update-state";
import { updateStateKey, type UpdateState } from "@/app/lib/update-status";
import { denyUnlessAdmin } from "@/app/lib/api-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events endpoint broadcasting the global update state to every
// connected client in realtime. Each connection immediately receives the current
// snapshot, then a frame on every change (progress, step, logs, terminal
// success/failure). Comment heartbeats keep intermediaries from dropping the
// idle connection during the long build phase.
//
// Note on the mid-update recreate: this container is replaced while the update
// runs, which drops open streams. That's expected — the browser's EventSource
// auto-reconnects, and the new container answers from the same persistent files,
// resuming exactly where things stand (usually "done").

const HEARTBEAT_MS = 15_000;

export async function GET(request: Request) {
  // Update logs echo build output and host paths — admin-only, like the trigger.
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastKey = "";

      const safeEnqueue = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      const sendState = (state: UpdateState) => {
        const key = updateStateKey(state);
        if (key === lastKey) return;
        lastKey = key;
        safeEnqueue(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      };

      // 1) Immediate snapshot so a client that just attached is never blank.
      sendState(await readUpdateState());

      // 2) Live changes for as long as the connection is open.
      const unsubscribe = subscribeUpdateState(sendState);

      // 3) Heartbeat so proxies keep the (potentially minutes-long) stream open.
      const heartbeat = setInterval(() => {
        if (!safeEnqueue(`: ping ${Date.now()}\n\n`)) cleanup();
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Client navigated away / reloaded → tear everything down.
      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx) so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
