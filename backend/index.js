const SESSION_COOKIE = "livescratch_session";

const SESSION_DAYS = 30;
const VERIFICATION_MINUTES = 60;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

function randomId() {
  return crypto.randomUUID();
}

function randomCode() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    byte => chars[byte % chars.length]
  ).join("");
}

function addMinutes(date, minutes) {
  return new Date(
    date.getTime() + minutes * 60 * 1000
  ).toISOString();
}

function addDays(date, days) {
  return new Date(
    date.getTime() + days * 24 * 60 * 60 * 1000
  ).toISOString();
}

function getSessionId(request) {
  const cookie =
    request.headers.get("Cookie") || "";

  const match = cookie.match(
    new RegExp(
      `${SESSION_COOKIE}=([^;]+)`
    )
  );

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function makeSessionCookie(id) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(id)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`
  ].join("; ");
}

function clearSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0"
  ].join("; ");
}

/*
 * 現在ログインしているユーザーを取得
 */
export async function getUser(request, env) {
  const sessionId = getSessionId(request);

  if (!sessionId) {
    return null;
  }

  const result = await env.DB.prepare(`
    SELECT
      users.id,
      users.scratch_id,
      users.username,
      users.display_name,
      users.avatar_url
    FROM sessions
    INNER JOIN users
      ON users.id = sessions.user_id
    WHERE sessions.id = ?
      AND sessions.expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `)
    .bind(sessionId)
    .first();

  return result || null;
}

export async function requireUser(request, env) {
  const user = await getUser(request, env);

  if (!user) {
    return {
      error: json(
        {
          error: "ログインが必要です。"
        },
        401
      )
    };
  }

  return {
    user
  };
}

/*
 * Scratch API
 */
export async function getScratchUser(username) {
  const response = await fetch(
    `https://api.scratch.mit.edu/users/${encodeURIComponent(
      username
    )}`
  );

  if (!response.ok) {
    return null;
  }

  return response.json();
}

/*
 * D1にユーザーを保存
 */
export async function saveUser(env, scratch) {
  const scratchId = Number(scratch.id);
  const username = scratch.username;

  const avatarUrl =
    `https://cdn2.scratch.mit.edu/get_image/user/${scratchId}_90x90.png`;

  await env.DB.prepare(`
    INSERT INTO users (
      scratch_id,
      username,
      display_name,
      avatar_url
    )
    VALUES (?, ?, ?, ?)

    ON CONFLICT(scratch_id)
    DO UPDATE SET
      username = excluded.username,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      updated_at = CURRENT_TIMESTAMP
  `)
    .bind(
      scratchId,
      username,
      username,
      avatarUrl
    )
    .run();

  return env.DB.prepare(`
    SELECT *
    FROM users
    WHERE scratch_id = ?
    LIMIT 1
  `)
    .bind(scratchId)
    .first();
}

/*
 * セッション作成
 */
async function createSession(env, userId) {
  const sessionId = randomId();

  const expiresAt = addDays(
    new Date(),
    SESSION_DAYS
  );

  await env.DB.prepare(`
    INSERT INTO sessions (
      id,
      user_id,
      expires_at
    )
    VALUES (?, ?, ?)
  `)
    .bind(
      sessionId,
      userId,
      expiresAt
    )
    .run();

  return sessionId;
}

/*
 * JSON body
 */
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/*
 * API
 */
export async function handleApi(
  request,
  env,
  url
) {
  const path = url.pathname;

  /*
   * GET /api/me
   */
  if (
    path === "/api/me" &&
    request.method === "GET"
  ) {
    const user = await getUser(
      request,
      env
    );

    return json({
      loggedIn: Boolean(user),
      user: user || null
    });
  }

  /*
   * POST /api/auth/scratch-user
   */
  if (
    path === "/api/auth/scratch-user" &&
    request.method === "POST"
  ) {
    const body = await readJson(request);

    if (!body) {
      return json(
        {
          error: "JSONが不正です。"
        },
        400
      );
    }

    const username =
      String(body.username || "").trim();

    if (!username) {
      return json(
        {
          error:
            "Scratchユーザー名を入力してください。"
        },
        400
      );
    }

    const scratch =
      await getScratchUser(username);

    if (!scratch) {
      return json(
        {
          error:
            "Scratchユーザーが見つかりません。"
        },
        404
      );
    }

    return json({
      username: scratch.username,
      id: scratch.id,
      profile: scratch.profile
    });
  }

  /*
   * POST /api/auth/scratch/start
   *
   * 認証コード発行
   */
  if (
    path === "/api/auth/scratch/start" &&
    request.method === "POST"
  ) {
    const body = await readJson(request);

    if (!body) {
      return json(
        {
          error: "JSONが不正です。"
        },
        400
      );
    }

    const username =
      String(body.username || "").trim();

    if (!username) {
      return json(
        {
          error:
            "Scratchユーザー名を入力してください。"
        },
        400
      );
    }

    const scratch =
      await getScratchUser(username);

    if (!scratch) {
      return json(
        {
          error:
            "Scratchユーザーが見つかりません。"
        },
        404
      );
    }

    const code = randomCode();

    const expiresAt =
      addMinutes(
        new Date(),
        VERIFICATION_MINUTES
      );

    await env.DB.prepare(`
      INSERT INTO verification_challenges (
        id,
        scratch_id,
        username,
        code,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?)
    `)
      .bind(
        randomId(),
        Number(scratch.id),
        scratch.username,
        code,
        expiresAt
      )
      .run();

    return json({
      username: scratch.username,
      scratch_id: Number(scratch.id),
      code,
      expires_at: expiresAt
    });
  }

  /*
   * POST /api/auth/scratch/verify
   */
  if (
    path === "/api/auth/scratch/verify" &&
    request.method === "POST"
  ) {
    const body = await readJson(request);

    if (!body) {
      return json(
        {
          error: "JSONが不正です。"
        },
        400
      );
    }

    const username =
      String(body.username || "").trim();

    const code =
      String(body.code || "")
        .trim()
        .toUpperCase();

    if (!username || !code) {
      return json(
        {
          error:
            "ユーザー名と認証コードが必要です。"
        },
        400
      );
    }

    const scratch =
      await getScratchUser(username);

    if (!scratch) {
      return json(
        {
          error:
            "Scratchユーザーが見つかりません。"
        },
        404
      );
    }

    /*
     * D1の認証コード確認
     */
    const challenge =
      await env.DB.prepare(`
        SELECT *
        FROM verification_challenges
        WHERE scratch_id = ?
          AND code = ?
          AND expires_at > CURRENT_TIMESTAMP
        ORDER BY created_at DESC
        LIMIT 1
      `)
        .bind(
          Number(scratch.id),
          code
        )
        .first();

    if (!challenge) {
      return json(
        {
          error:
            "認証コードが違うか、期限切れです。"
        },
        403
      );
    }

    /*
     * ScratchプロフィールのAbout Me
     *
     * コードが文章のどこにあってもOK
     */
    const bio =
      String(
        scratch.profile?.bio || ""
      );

    if (!bio.includes(code)) {
      return json(
        {
          error:
            "Scratchプロフィールの「About Me」に認証コードを入れてください。"
        },
        403
      );
    }

    /*
     * ユーザー保存
     */
    const user =
      await saveUser(
        env,
        scratch
      );

    /*
     * セッション作成
     */
    const sessionId =
      await createSession(
        env,
        user.id
      );

    /*
     * 使用済みコードを削除
     */
    await env.DB.prepare(`
      DELETE FROM verification_challenges
      WHERE scratch_id = ?
    `)
      .bind(Number(scratch.id))
      .run();

    return json(
      {
        ok: true,
        user
      },
      200,
      {
        "Set-Cookie":
          makeSessionCookie(sessionId)
      }
    );
  }

  /*
   * POST /api/auth/logout
   */
  if (
    path === "/api/auth/logout" &&
    request.method === "POST"
  ) {
    const sessionId =
      getSessionId(request);

    if (sessionId) {
      await env.DB.prepare(`
        DELETE FROM sessions
        WHERE id = ?
      `)
        .bind(sessionId)
        .run();
    }

    return json(
      {
        ok: true
      },
      200,
      {
        "Set-Cookie":
          clearSessionCookie()
      }
    );
  }

  /*
   * GET /api/rooms
   *
   * ルーム一覧
   */
  if (
    path === "/api/rooms" &&
    request.method === "GET"
  ) {
    const auth =
      await requireUser(
        request,
        env
      );

    if (auth.error) {
      return auth.error;
    }

    const result =
      await env.DB.prepare(`
        SELECT
          rooms.id,
          rooms.name,
          rooms.owner_user_id,
          rooms.is_private,
          rooms.created_at,
          users.username AS owner_username,
          users.avatar_url AS owner_avatar_url
        FROM rooms
        INNER JOIN users
          ON users.id = rooms.owner_user_id
        ORDER BY rooms.created_at DESC
      `)
        .all();

    return json({
      rooms: result.results || []
    });
  }

  /*
   * POST /api/rooms
   *
   * ルーム作成
   */
  if (
    path === "/api/rooms" &&
    request.method === "POST"
  ) {
    const auth =
      await requireUser(
        request,
        env
      );

    if (auth.error) {
      return auth.error;
    }

    const body =
      await readJson(request);

    if (!body) {
      return json(
        {
          error: "JSONが不正です。"
        },
        400
      );
    }

    const name =
      String(body.name || "").trim();

    const isPrivate =
      Boolean(body.is_private);

    if (!name) {
      return json(
        {
          error:
            "ルーム名を入力してください。"
        },
        400
      );
    }

    if (name.length > 100) {
      return json(
        {
          error:
            "ルーム名が長すぎます。"
        },
        400
      );
    }

    const roomId =
      randomId();

    await env.DB.prepare(`
      INSERT INTO rooms (
        id,
        name,
        owner_user_id,
        is_private
      )
      VALUES (?, ?, ?, ?)
    `)
      .bind(
        roomId,
        name,
        auth.user.id,
        isPrivate ? 1 : 0
      )
      .run();

    /*
     * 作成者は自動的にメンバー
     */
    await env.DB.prepare(`
      INSERT INTO room_members (
        room_id,
        user_id
      )
      VALUES (?, ?)
    `)
      .bind(
        roomId,
        auth.user.id
      )
      .run();

    return json(
      {
        ok: true,
        room: {
          id: roomId,
          name,
          owner_user_id:
            auth.user.id,
          is_private:
            isPrivate ? 1 : 0
        }
      },
      201
    );
  }

  /*
   * POST /api/rooms/:id/join
   */
  const joinMatch =
    path.match(
      /^\/api\/rooms\/([^/]+)\/join$/
    );

  if (
    joinMatch &&
    request.method === "POST"
  ) {
    const roomId =
      decodeURIComponent(
        joinMatch[1]
      );

    const auth =
      await requireUser(
        request,
        env
      );

    if (auth.error) {
      return auth.error;
    }

    const room =
      await env.DB.prepare(`
        SELECT *
        FROM rooms
        WHERE id = ?
        LIMIT 1
      `)
        .bind(roomId)
        .first();

    if (!room) {
      return json(
        {
          error:
            "ルームが見つかりません。"
        },
        404
      );
    }

    /*
     * 公開ルームなら参加可能。
     * 非公開ルームは所有者だけ自動参加。
     *
     * 本格的な招待・承認機能は
     * 後でここに追加できる。
     */
    if (
      Number(room.is_private) === 1 &&
      String(room.owner_user_id) !==
        String(auth.user.id)
    ) {
      return json(
        {
          error:
            "このルームは非公開です。"
        },
        403
      );
    }

    await env.DB.prepare(`
      INSERT OR IGNORE INTO room_members (
        room_id,
        user_id
      )
      VALUES (?, ?)
    `)
      .bind(
        roomId,
        auth.user.id
      )
      .run();

    return json({
      ok: true,
      room
    });
  }

  /*
   * GET /api/rooms/:id
   */
  const roomMatch =
    path.match(
      /^\/api\/rooms\/([^/]+)$/
    );

  if (
    roomMatch &&
    request.method === "GET"
  ) {
    const roomId =
      decodeURIComponent(
        roomMatch[1]
      );

    const auth =
      await requireUser(
        request,
        env
      );

    if (auth.error) {
      return auth.error;
    }

    const room =
      await env.DB.prepare(`
        SELECT
          rooms.*,
          users.username AS owner_username
        FROM rooms
        INNER JOIN users
          ON users.id = rooms.owner_user_id
        WHERE rooms.id = ?
        LIMIT 1
      `)
        .bind(roomId)
        .first();

    if (!room) {
      return json(
        {
          error:
            "ルームが見つかりません。"
        },
        404
      );
    }

    const member =
      await env.DB.prepare(`
        SELECT 1
        FROM room_members
        WHERE room_id = ?
          AND user_id = ?
        LIMIT 1
      `)
        .bind(
          roomId,
          auth.user.id
        )
        .first();

    if (!member) {
      return json(
        {
          error:
            "このルームへの参加権限がありません。"
        },
        403
      );
    }

    const members =
      await env.DB.prepare(`
        SELECT
          users.id,
          users.scratch_id,
          users.username,
          users.display_name,
          users.avatar_url
        FROM room_members
        INNER JOIN users
          ON users.id = room_members.user_id
        WHERE room_members.room_id = ?
        ORDER BY room_members.joined_at ASC
      `)
        .bind(roomId)
        .all();

    return json({
      room,
      members:
        members.results || []
    });
  }

  return json(
    {
      error: "Not Found"
    },
    404
  );
}
