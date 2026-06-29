#!/usr/bin/env node
/**
 * Google Analytics MCP server (custom, Node.js)
 *
 * A read-only Model Context Protocol server that exposes Google Analytics 4
 * (GA4) data to MCP clients such as Claude Desktop and Claude Code.
 *
 * Inspired by Google's official analytics-mcp server
 * (https://github.com/googleanalytics/google-analytics-mcp), but written in
 * Node.js so it fits this project's stack.
 *
 * Authentication uses Application Default Credentials (ADC). Provide a service
 * account key via GOOGLE_APPLICATION_CREDENTIALS, or run
 * `gcloud auth application-default login` with the
 * https://www.googleapis.com/auth/analytics.readonly scope.
 *
 * Transport: stdio (the transport Claude Desktop / Claude Code use to launch
 * and talk to local MCP servers).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { AnalyticsAdminServiceClient } from "@google-analytics/admin";

// ---------------------------------------------------------------------------
// Clients (lazily instantiated so the server can start even before auth is
// resolved, and so auth errors surface as readable tool errors).
// ---------------------------------------------------------------------------

let dataClient;
let adminClient;

function getDataClient() {
  if (!dataClient) dataClient = new BetaAnalyticsDataClient();
  return dataClient;
}

function getAdminClient() {
  if (!adminClient) adminClient = new AnalyticsAdminServiceClient();
  return adminClient;
}

/** Normalize a property id ("properties/123" or "123") to "properties/123". */
function toPropertyResource(property) {
  const id = String(property).trim();
  return id.startsWith("properties/") ? id : `properties/${id}`;
}

/** Wrap a value as a single text-content tool result. */
function textResult(value) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Wrap an error as an isError tool result with a readable message. */
function errorResult(error) {
  const message = error?.details || error?.message || String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/** Flatten a GA4 report response into row objects keyed by header name. */
function formatReport(response) {
  const dimHeaders = (response.dimensionHeaders || []).map((h) => h.name);
  const metHeaders = (response.metricHeaders || []).map((h) => h.name);
  const rows = (response.rows || []).map((row) => {
    const obj = {};
    (row.dimensionValues || []).forEach((v, i) => {
      obj[dimHeaders[i] ?? `dimension_${i}`] = v.value;
    });
    (row.metricValues || []).forEach((v, i) => {
      obj[metHeaders[i] ?? `metric_${i}`] = v.value;
    });
    return obj;
  });
  return {
    rowCount: response.rowCount ?? rows.length,
    dimensionHeaders: dimHeaders,
    metricHeaders: metHeaders,
    rows,
  };
}

/**
 * Build a GA4 FilterExpression from a simple list of dimension/metric filters.
 * Each filter: { fieldName, value, matchType?, operation? }. Multiple filters
 * are combined with AND. Returns undefined when no filters are given.
 */
function buildFilterExpression(filters, kind) {
  if (!filters || filters.length === 0) return undefined;
  const expressions = filters.map((f) => {
    if (kind === "metric") {
      const operation = (f.operation || "GREATER_THAN").toUpperCase();
      const numericValue = /^\d+$/.test(String(f.value))
        ? { int64Value: String(f.value) }
        : { doubleValue: Number(f.value) };
      return {
        filter: {
          fieldName: f.fieldName,
          numericFilter: { operation, value: numericValue },
        },
      };
    }
    return {
      filter: {
        fieldName: f.fieldName,
        stringFilter: {
          matchType: (f.matchType || "EXACT").toUpperCase(),
          value: String(f.value),
          caseSensitive: false,
        },
      },
    };
  });
  return expressions.length === 1
    ? expressions[0]
    : { andGroup: { expressions } };
}

// ---------------------------------------------------------------------------
// Server + tools
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "google-analytics",
  version: "1.0.0",
});

const dimensionFilterSchema = z
  .array(
    z.object({
      fieldName: z.string().describe("Dimension name, e.g. 'country', 'city'"),
      value: z.string().describe("Value to match against"),
      matchType: z
        .enum(["EXACT", "BEGINS_WITH", "ENDS_WITH", "CONTAINS", "FULL_REGEXP"])
        .optional()
        .describe("How to match the value (default EXACT)"),
    })
  )
  .optional()
  .describe("Optional dimension filters, combined with AND");

const metricFilterSchema = z
  .array(
    z.object({
      fieldName: z.string().describe("Metric name, e.g. 'sessions'"),
      value: z.union([z.string(), z.number()]).describe("Numeric threshold"),
      operation: z
        .enum([
          "EQUAL",
          "LESS_THAN",
          "LESS_THAN_OR_EQUAL",
          "GREATER_THAN",
          "GREATER_THAN_OR_EQUAL",
        ])
        .optional()
        .describe("Comparison operation (default GREATER_THAN)"),
    })
  )
  .optional()
  .describe("Optional metric filters, combined with AND");

// --- Account / property discovery (Admin API) ------------------------------

server.registerTool(
  "list_account_summaries",
  {
    title: "List GA4 accounts and properties",
    description:
      "List all Google Analytics accounts and their GA4 properties the " +
      "authenticated user can access. Use this first to discover property IDs " +
      "needed by the reporting tools.",
    inputSchema: {},
  },
  async () => {
    try {
      const client = getAdminClient();
      const summaries = [];
      const iterable = client.listAccountSummariesAsync({});
      for await (const summary of iterable) {
        summaries.push({
          account: summary.account,
          accountName: summary.displayName,
          properties: (summary.propertySummaries || []).map((p) => ({
            property: p.property,
            displayName: p.displayName,
            propertyType: p.propertyType,
            parent: p.parent,
          })),
        });
      }
      return textResult({ accountCount: summaries.length, accounts: summaries });
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_property_details",
  {
    title: "Get GA4 property details",
    description:
      "Get configuration details for a single GA4 property (name, time zone, " +
      "currency, industry category, create/update time).",
    inputSchema: {
      property: z
        .string()
        .describe("Property id or resource, e.g. '123456789' or 'properties/123456789'"),
    },
  },
  async ({ property }) => {
    try {
      const client = getAdminClient();
      const [details] = await client.getProperty({
        name: toPropertyResource(property),
      });
      return textResult(details);
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_metadata",
  {
    title: "List available dimensions and metrics",
    description:
      "List the dimensions and metrics available for a GA4 property, including " +
      "any custom dimensions/metrics. Use this to find valid field names for " +
      "run_report.",
    inputSchema: {
      property: z
        .string()
        .describe("Property id or resource, e.g. '123456789'"),
    },
  },
  async ({ property }) => {
    try {
      const client = getDataClient();
      const [metadata] = await client.getMetadata({
        name: `${toPropertyResource(property)}/metadata`,
      });
      return textResult({
        dimensions: (metadata.dimensions || []).map((d) => ({
          apiName: d.apiName,
          uiName: d.uiName,
          description: d.description,
          customDefinition: d.customDefinition,
        })),
        metrics: (metadata.metrics || []).map((m) => ({
          apiName: m.apiName,
          uiName: m.uiName,
          description: m.description,
          type: m.type,
          customDefinition: m.customDefinition,
        })),
      });
    } catch (error) {
      return errorResult(error);
    }
  }
);

// --- Core reporting (Data API) ---------------------------------------------

server.registerTool(
  "run_report",
  {
    title: "Run a GA4 report",
    description:
      "Run a standard GA4 report. Specify dimensions and metrics (use " +
      "get_metadata to discover valid names), a date range, optional filters, " +
      "ordering, and a row limit. Dates accept 'YYYY-MM-DD' or relative values " +
      "like 'today', 'yesterday', or 'NdaysAgo' (e.g. '7daysAgo').",
    inputSchema: {
      property: z.string().describe("Property id or resource, e.g. '123456789'"),
      dimensions: z
        .array(z.string())
        .optional()
        .describe("Dimension names, e.g. ['date','country']"),
      metrics: z
        .array(z.string())
        .min(1)
        .describe("Metric names, e.g. ['activeUsers','sessions']"),
      startDate: z.string().describe("Start date, e.g. '28daysAgo' or '2024-01-01'"),
      endDate: z.string().describe("End date, e.g. 'today' or '2024-01-31'"),
      dimensionFilters: dimensionFilterSchema,
      metricFilters: metricFilterSchema,
      orderByMetric: z
        .string()
        .optional()
        .describe("Metric name to order results by (descending)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(250000)
        .optional()
        .describe("Maximum number of rows to return (default 50)"),
    },
  },
  async (args) => {
    try {
      const client = getDataClient();
      const request = {
        property: toPropertyResource(args.property),
        dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
        dimensions: (args.dimensions || []).map((name) => ({ name })),
        metrics: args.metrics.map((name) => ({ name })),
        limit: args.limit ?? 50,
      };
      const dimFilter = buildFilterExpression(args.dimensionFilters, "dimension");
      if (dimFilter) request.dimensionFilter = dimFilter;
      const metFilter = buildFilterExpression(args.metricFilters, "metric");
      if (metFilter) request.metricFilter = metFilter;
      if (args.orderByMetric) {
        request.orderBys = [
          { metric: { metricName: args.orderByMetric }, desc: true },
        ];
      }
      const [response] = await client.runReport(request);
      return textResult(formatReport(response));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "run_realtime_report",
  {
    title: "Run a GA4 realtime report",
    description:
      "Run a GA4 realtime report covering roughly the last 30 minutes. Useful " +
      "for 'how many users are on the site right now' style questions.",
    inputSchema: {
      property: z.string().describe("Property id or resource, e.g. '123456789'"),
      dimensions: z
        .array(z.string())
        .optional()
        .describe("Realtime dimensions, e.g. ['country','unifiedScreenName']"),
      metrics: z
        .array(z.string())
        .min(1)
        .describe("Realtime metrics, e.g. ['activeUsers']"),
      limit: z
        .number()
        .int()
        .positive()
        .max(250000)
        .optional()
        .describe("Maximum number of rows to return (default 50)"),
    },
  },
  async (args) => {
    try {
      const client = getDataClient();
      const [response] = await client.runRealtimeReport({
        property: toPropertyResource(args.property),
        dimensions: (args.dimensions || []).map((name) => ({ name })),
        metrics: args.metrics.map((name) => ({ name })),
        limit: args.limit ?? 50,
      });
      return textResult(formatReport(response));
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is reserved for the MCP protocol.
  console.error("Google Analytics MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting GA MCP server:", error);
  process.exit(1);
});
