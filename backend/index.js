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

  if (!match) return null;

  return decodeURIComponent(match[1]);
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
 * 現在ログインしているユーザー
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
  `)
    .bind(sessionId)
    .first();

  return result || null;
}

export async function requireUser(
  request,
  env
) {
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
 * Scratch APIからユーザーを取得
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
 * D1へユーザー保存
 */
export async function saveUser(
  env,
  scratch
) {
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
      avatar_url = excluded.avatar_url
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
  `)
    .bind(scratchId)
    .first();
}

/*
 * セッション作成
 */
async function createSession(
  env,
  userId
) {
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
 * API本体
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
   *
   * Scratchユーザー情報取得
   */
  if (
    path === "/api/auth/scratch-user" &&
    request.method === "POST"
  ) {
    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        {
          error: "JSONが不正です。"
        },
        400
      );
    }

    const username =
      String(body.username || "")
        .trim();

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
    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        {
          error: "JSONが不正です。"
        },
        400
      );
    }

    const username =
      String(body.username || "")
        .trim();

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
    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        {
          error: "JSONが不正です。"
        },
        400
      );
    }

    const username =
      String(body.username || "")
        .trim();

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
     * Scratchのプロフィールを再取得。
     *
     * 認証コードはAbout Me
     * （profile.bio）に含まれていればOK。
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

    const user =
      await saveUser(env, scratch);

    const sessionId =
      await createSession(
        env,
        user.id
      );

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

  return json(
    {
      error: "Not Found"
    },
    404
  );
}
