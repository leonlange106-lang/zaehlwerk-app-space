import { type NextRequest, NextResponse } from "next/server";
import { deleteLog, getLog, updateLogTags } from "@/app/lib/log-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A single persisted log: GET the full record (incl. CSV for re-parsing),
// PATCH its tags (octane / free tags), or DELETE it.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const log = await getLog(id);
  if (!log) return NextResponse.json({ error: "Log nicht gefunden." }, { status: 404 });
  return NextResponse.json({ log }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body." }, { status: 400 });
  }
  const b = body as { octane?: unknown; tags?: unknown };
  const patch: { octane?: string | null; tags?: string[] } = {};
  if (b.octane !== undefined) patch.octane = b.octane === null ? null : String(b.octane);
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) {
      return NextResponse.json({ error: "tags muss ein Array sein." }, { status: 400 });
    }
    patch.tags = b.tags.map((t) => String(t));
  }
  const log = await updateLogTags(id, patch);
  if (!log) return NextResponse.json({ error: "Log nicht gefunden." }, { status: 404 });
  return NextResponse.json({ log });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteLog(id);
  if (!ok) return NextResponse.json({ error: "Log nicht gefunden." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
