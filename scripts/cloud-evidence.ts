import { writeFile } from "node:fs/promises";

import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const region = process.env.AWS_REGION ?? "us-east-1";
const output = process.argv[2];
if (!output) throw new Error("Usage: npm run cloud:evidence -- <output.json>");
const response = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
const evidence = {
  capturedAt: new Date().toISOString(), region, account: response.Account, arn: response.Arn,
  providerRequestId: response.$metadata.requestId, source: "aws-sts:GetCallerIdentity",
};
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
