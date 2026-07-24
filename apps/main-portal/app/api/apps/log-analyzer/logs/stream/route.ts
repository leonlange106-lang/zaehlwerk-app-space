import { getSessionUser } from "@/app/lib/auth-helpers";
import { subscribeLogEvents, type LogIngestedEvent } from "@/app/lib/log-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events stream of "a log was just ingested" events, so an open log
// overview refreshes in realtime the moment a log arrives via the ingestion API
// or the watch-folder. Session-gated (this is the browser-facing stream, not the
// machine ingestion endpoint). Mirrors the update-state SSE route: immediate
// keep-alive, a frame per event, comment heartbeats to hold the idle connection.

const HEARTBEAT_MS = 15_000;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

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

      // Open with a comment so the client's EventSource fires `onopen` promptly.
      safeEnqueue(`: connected ${Date.now()}\n\n`);

      const onEvent = (event: LogIngestedEvent) => {
        safeEnqueue(`event: ingested\ndata: ${JSON.stringify(event)}\n\n`);
      };
      const unsubscribe = subscribeLogEvents(onEvent);

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

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
