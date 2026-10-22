import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";

export const runtime = "nodejs";

/** Adds a call-feedback note to a participant. Body: { body: string }. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  let raw: { body?: unknown };
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!body) return NextResponse.json({ error: "Write a note first." }, { status: 400 });
  if (body.length > 5000) return NextResponse.json({ error: "That note is too long (max 5,000 characters)." }, { status: 400 });

  const existing = await prisma.registration.findUnique({ where: { id }, select: { fullName: true } });
  if (!existing) return NextResponse.json({ error: "Participant not found." }, { status: 404 });

  const note = await prisma.followUpNote.create({ data: { registrationId: id, body, authorName: session?.name ?? null } });
  await logAdminAction(session, { action: "participant.note", entityType: "registration", entityId: id, entityLabel: existing.fullName }, request);

  return NextResponse.json({ result: "success", note: { id: note.id, body: note.body, authorName: note.authorName, createdAt: note.createdAt.toISOString() } });
}

/** Deletes one note. Body: { noteId: string }. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw: { noteId?: unknown };
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const noteId = typeof raw.noteId === "string" ? raw.noteId : "";
  const res = await prisma.followUpNote.deleteMany({ where: { id: noteId, registrationId: id } });
  if (res.count === 0) return NextResponse.json({ error: "Note not found." }, { status: 404 });
  return NextResponse.json({ result: "success" });
}
