import {
  handleApi,
  getUser
} from "../backend/index.js";

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

function getRoomId(pathname) {
  const match = pathname.match(/^\/ws\/([^/]+)$/);

  if (!match) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * CORS preflight
     */
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
      try {
        const response =
          await handleApi(request, env, url);

        return withCors(response, request);

      } catch (error) {
        console.error("API error:", error);

        return withCors(
          new Response(
            JSON.stringify({
              error:
                "サーバー内部でエラーが発生しました。"
            }),
            {
              status: 500,
              headers: {
                "Content-Type":
                  "application/json; charset=utf-8"
              }
            }
          ),
          request
        );
      }
    }

    /*
     * Cloudflare Durable Object WebSocket
     */
    if (
      url.pathname.startsWith("/ws/") &&
      request.headers
        .get("Upgrade")
        ?.toLowerCase() === "websocket"
    ) {
      const roomId = getRoomId(url.pathname);

      if (!roomId) {
        return new Response(
          "Room ID is required.",
          { status: 400 }
        );
      }

      /*
       * 現在ログインしているScratchユーザーを取得
       */
      const user = await getUser(request, env);

      if (!user) {
        return new Response(
          "Authentication required.",
          { status: 401 }
        );
      }

      /*
       * ルームへの参加権限を確認
       */
      const member =
        await env.DB.prepare(`
          SELECT
            room_members.room_id,
            room_members.user_id
          FROM room_members
          INNER JOIN rooms
            ON rooms.id = room_members.room_id
          WHERE room_members.room_id = ?
            AND room_members.user_id = ?
          LIMIT 1
        `)
          .bind(roomId, user.id)
          .first();

      if (!member) {
        return new Response(
          "You are not a member of this room.",
          { status: 403 }
        );
      }

      /*
       * Durable ObjectをルームIDから取得
       */
      const id =
        env.ROOMS.idFromName(roomId);

      const stub =
        env.ROOMS.get(id);

      /*
       * Durable Objectへユーザー情報を渡す
       */
      const headers =
        new Headers(request.headers);

      headers.set(
        "X-Room-Id",
        roomId
      );

      headers.set(
        "X-User-Id",
        String(user.id)
      );

      headers.set(
        "X-Username",
        String(user.username)
      );

      headers.set(
        "X-Scratch-Id",
        String(user.scratch_id)
      );

      const roomRequest =
        new Request(request, {
          headers
        });

      return stub.fetch(roomRequest);
    }

    /*
     * その他は静的ファイル
     */
    return env.ASSETS.fetch(request);
  }
};
