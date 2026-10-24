import { NextResponse } from "next/server";
import { RuleBasedWorkflowCompiler } from "../../../domain/compiler";
import { createCase, listCases } from "../../../server/repository";
import { createCaseSchema } from "../../../domain/validation";

export async function GET() { return NextResponse.json(await listCases()); }
export async function POST(request: Request) {
  const parsed = createCaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const compiled = new RuleBasedWorkflowCompiler().compile(parsed.data.originalInput);
  if (!compiled.workflow) return NextResponse.json({ error: compiled.error }, { status: 422 });
  try { return NextResponse.json(await createCase(parsed.data.originalInput, compiled.workflow), { status: 201 }); } catch { return NextResponse.json({ error: "Unable to persist case. Run database setup first." }, { status: 500 }); }
}
