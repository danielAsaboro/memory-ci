# Managed MCP evidence procedure

Memory CI uses the CockroachDB Cloud Managed MCP endpoint as a read-only incident auditor. Never commit a cluster ID, bearer token, query result containing customer content, or raw audit export.

## Client configuration

```json
{
  "mcpServers": {
    "cockroachdb-cloud": {
      "type": "http",
      "url": "https://cockroachlabs.cloud/mcp",
      "headers": {
        "mcp-cluster-id": "${COCKROACH_CLUSTER_ID}"
      }
    }
  }
}
```

Authorize only `mcp:read`. OAuth with PKCE is preferred; a cluster-scoped service account is the non-interactive alternative.

## Judge-visible proof prompt

> In read-only mode, identify the active memory version that controls Northstar refund review, its revision, signed source, bound evaluation, approving reviewer, latest activation event, and the read receipt for Refund Agent B. Then EXPLAIN the tenant- and namespace-filtered vector-neighbor query. Do not return canonical customer content or secret fields.

Expected Managed MCP tools: `get_table_schema`, `select_query`, and `explain_query`. A successful capture must include the cluster ID, sanitized row identifiers, provider request IDs, and timestamp. Until Cloud authentication exists, this procedure is configuration evidence only and must not be described as an executed MCP session.

Official setup: <https://www.cockroachlabs.com/docs/cockroachcloud/connect-to-the-cockroachdb-cloud-mcp-server>
