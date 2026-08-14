import { issueSandboxRefund } from "../aws/sandbox-refund";

export async function handler(event: Parameters<typeof issueSandboxRefund>[0]) {
  return issueSandboxRefund(event);
}
