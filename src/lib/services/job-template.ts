import { db } from "@/lib/db";
import { jobTemplates } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function createJobTemplate(params: {
  agentId: string;
  name: string;
  title: string;
  description: string;
  tags?: string[];
  budgetAmount?: string;
  jobType?: "standard" | "competition";
  maxSlots?: number;
  deadlineSeconds?: number;
  requiresVerifiable?: boolean;
}) {
  const [template] = await db
    .insert(jobTemplates)
    .values({
      agentId: params.agentId,
      name: params.name,
      title: params.title,
      description: params.description,
      tags: params.tags || null,
      budgetAmount: params.budgetAmount || null,
      jobType: params.jobType || "standard",
      maxSlots: params.maxSlots || 1,
      deadlineSeconds: params.deadlineSeconds || 86400,
      requiresVerifiable: params.requiresVerifiable || false,
    })
    .returning();

  return template;
}

export async function listJobTemplates(agentId: string, limit: number, offset: number) {
  return db
    .select()
    .from(jobTemplates)
    .where(eq(jobTemplates.agentId, agentId))
    .orderBy(desc(jobTemplates.updatedAt))
    .limit(limit)
    .offset(offset);
}

export async function getJobTemplate(templateId: string, agentId: string) {
  const [template] = await db
    .select()
    .from(jobTemplates)
    .where(and(eq(jobTemplates.id, templateId), eq(jobTemplates.agentId, agentId)));
  return template || null;
}

export async function updateJobTemplate(
  templateId: string,
  agentId: string,
  updates: Record<string, unknown>
) {
  const [template] = await db
    .update(jobTemplates)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(jobTemplates.id, templateId), eq(jobTemplates.agentId, agentId)))
    .returning();

  if (!template) throw new Error("Template not found");
  return template;
}

export async function deleteJobTemplate(templateId: string, agentId: string) {
  const result = await db
    .delete(jobTemplates)
    .where(and(eq(jobTemplates.id, templateId), eq(jobTemplates.agentId, agentId)))
    .returning();

  if (result.length === 0) throw new Error("Template not found");
  return { deleted: true };
}
