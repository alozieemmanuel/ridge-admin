import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";

export const runtime = "nodejs";

/** Deletes one follow-up entry (owner only). Body: { noteId: string }. The deletion itself is written to the guest's activity. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Only an owner can delete follow-up entries." }, { status: 403 });

  let raw: { noteId?: unknown };
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const noteId = typeof raw.noteId === "string" ? raw.noteId : "";
  const note = await prisma.followUpNote.findFirst({ where: { id: noteId, registrationId: id }, include: { registration: { select: { fullName: true } } } });
  if (!note) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  await prisma.followUpNote.delete({ where: { id: noteId } });
  await logAdminAction(
    session,
    { action: "participant.note_delete", entityType: "registration", entityId: id, entityLabel: note.registration.fullName, details: { feedback: note.body } },
    request
  );
  return NextResponse.json({ result: "success" });
}
