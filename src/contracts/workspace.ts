import { z } from "zod";

export const workspaceBootstrapSchema = z.object({
  tenantId: z.string().min(1),
  principalId: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
  workspaceName: z.string().min(1),
}).strict();

export type WorkspaceBootstrap = z.infer<typeof workspaceBootstrapSchema>;

export type WorkspaceMetadata = WorkspaceBootstrap;
