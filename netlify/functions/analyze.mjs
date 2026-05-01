import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { analyze } = require("../../server.js");

export default async (request) => {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  try {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") || "";
    const company = url.searchParams.get("company") || "";
    const payload = await analyze(role, company);

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};

export const config = {
  path: "/api/analyze",
  method: ["GET"],
};
