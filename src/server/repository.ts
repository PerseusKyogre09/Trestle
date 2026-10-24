import { prisma } from "./db";
import type { Action, Case, Evidence, Workflow } from "../domain/types";
import { readiness } from "../domain/engine";

const parse = <T>(value: string): T => JSON.parse(value) as T;
const mapAction = (a: Awaited<ReturnType<typeof prisma.action.findMany>>[number]): Action => ({ ...a, status: a.status as Action["status"], priority: a.priority as Action["priority"], riskLevel: a.riskLevel as Action["riskLevel"], executionMode: a.executionMode as Action["executionMode"], dependencies: parse<string[]>(a.dependencies), requiredInputs: parse<string[]>(a.requiredInputs), successCriteria: parse<string[]>(a.successCriteria), evidence: parse<Evidence[]>(a.evidence), createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() });

export async function createCase(input: string, workflow: Workflow): Promise<Case> {
  const id = crypto.randomUUID();
  const result = await prisma.case.create({ data: { id, title: workflow.title, description: workflow.description, originalInput: input, actions: { create: workflow.actions.map((a) => ({ id: a.id, title: a.title, description: a.description, status: a.status, priority: a.priority, riskLevel: a.riskLevel, approvalRequired: a.approvalRequired, requiredInputs: JSON.stringify(a.requiredInputs), successCriteria: JSON.stringify(a.successCriteria), evidence: JSON.stringify(a.evidence), executionMode: a.executionMode, dependencies: JSON.stringify(a.dependencies) })) } }, include: { actions: true } });
  return { ...result, status: result.status as Case["status"], createdAt: result.createdAt.toISOString(), updatedAt: result.updatedAt.toISOString(), actions: result.actions.map(mapAction) };
}
const mapCase = (result: Awaited<ReturnType<typeof prisma.case.findUnique>> & { actions: Awaited<ReturnType<typeof prisma.action.findMany>> }): Case => { const actions = result.actions.map(mapAction); const ready = readiness(actions); return { ...result, status: result.status as Case["status"], createdAt: result.createdAt.toISOString(), updatedAt: result.updatedAt.toISOString(), actions: actions.map((a) => a.status === "pending" ? { ...a, status: ready.find((r) => r.id === a.id)?.ready ? "ready" : "blocked" } : a) as Action[] }; };
export async function listCases(): Promise<Case[]> { const results = await prisma.case.findMany({ orderBy: { updatedAt: "desc" }, include: { actions: true } }); return results.map(mapCase); }
export async function getCase(id: string): Promise<Case | null> { const result = await prisma.case.findUnique({ where: { id }, include: { actions: true } }); return result ? mapCase(result) : null; }
export async function updateAction(id: string, status: string, evidence?: Evidence) { const a = await prisma.action.findUnique({ where: { id } }); if (!a) return null; const nextEvidence = evidence ? [...parse<Evidence[]>(a.evidence), evidence] : parse<Evidence[]>(a.evidence); return prisma.action.update({ where: { id }, data: { status, evidence: JSON.stringify(nextEvidence) } }); }
