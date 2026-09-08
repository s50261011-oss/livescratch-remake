import { handleApi } from "../backend/index.js";
import Room from "../backend/WebSockets.js";

export { Room };

function corsHeaders(request) {
  const origin = request.headers.get("Origin");

  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "Content-Type, Cookie, Authorization",
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, DELETE, OPTIONS"
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(
    corsHeaders(request)
  )) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    /*
     * API
     */
    if (url.pathname.startsWith("/api/")) {
      const response = await handleApi(request, env, url);
      return withCors(response, request);
    }

    /*
     * WebSocket
     *
     * /ws/:roomId
     */
    if (
      url.pathname.startsWith("/ws/") &&
      request.headers.get("Upgrade") === "websocket"
    ) {
      const roomId = url.pathname.split("/")[2];

      if (!roomId) {
        return new Response("Room ID is required.", {
          status: 400
        });
      }

      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);

      return stub.fetch(request);
    }

    /*
     * 静的ファイル
     */
    return env.ASSETS.fetch(request);
  }
};
