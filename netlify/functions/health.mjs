import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { healthPayload } = require("../../server.js");

export default async (request) => {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify(healthPayload(), null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};

export const config = {
  path: "/api/health",
  method: ["GET"],
};
