// backend/index.js

const SCRATCH_API =
  "https://api.scratch.mit.edu";

const SESSION_COOKIE =
  "livescratch_session";

const SESSION_DAYS = 30;

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}

function getCookie(request, name) {
  const cookie =
    request.headers.get("Cookie");

  if (!cookie) {
    return null;
  }

  const match = cookie.match(
    new RegExp(
      "(?:^|;\\s*)" +
      name.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      ) +
      "=([^;]*)"
    )
  );

  return match
    ? decodeURIComponent(match[1])
    : null;
}

function sessionCookie(
  sessionId,
  maxAge
) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ].join("; ");
}

function randomId() {
  return crypto.randomUUID();
}

function verificationCode() {
  const bytes =
    new Uint8Array(8);

  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("")
    .toUpperCase();
}

/*
 * Scratch APIからユーザー情報を取得
 */
async function getScratchUser(
  username
) {
  const response =
    await fetch(
      `${SCRATCH_API}/users/${encodeURIComponent(username)}`
    );

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

/*
 * Scratchプロフィールを取得
 */
async function getScratchProfile(
  username
) {
  const response =
    await fetch(
      `${SCRATCH_API}/users/${encodeURIComponent(username)}`
    );

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

/*
 * ログインユーザーを取得
 */
export async function getUser(
  request,
  env
) {
  const sessionId =
    getCookie(
      request,
      SESSION_COOKIE
    );

  if (!sessionId) {
    return null;
  }

  const session =
    await env.DB.prepare(`
      SELECT
        sessions.id,
        sessions.user_id,
        sessions.expires_at,
        users.id AS local_user_id,
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

  if (!session) {
    return null;
  }

  return {
    id: session.local_user_id,
    scratch_id: session.scratch_id,
    username: session.username,
    display_name:
      session.display_name,
    avatar_url:
      session.avatar_url
  };
}

export async function requireUser(
  request,
  env
) {
  const user =
    await getUser(
      request,
      env
    );

  if (!user) {
    return {
      user: null,
      response: json(
        {
          error:
            "ログインが必要です。"
        },
        401
      )
    };
  }

  return {
    user,
    response: null
  };
}

/*
 * ScratchユーザーをDBへ保存
 */
async function upsertUser(
  env,
  scratchUser
) {
  const scratchId =
    Number(scratchUser.id);

  const username =
    String(
      scratchUser.username
    );

  const displayName =
    String(
      scratchUser.username
    );

  const avatarUrl =
    `https://uploads.scratch.mit.edu/get_image/user/${scratchId}_90x90.png`;

  await env.DB.prepare(`
    INSERT INTO users
      (
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
      displayName,
      avatarUrl
    )
    .run();

  return await env.DB.prepare(`
    SELECT *
    FROM users
    WHERE scratch_id = ?
    LIMIT 1
  `)
    .bind(scratchId)
    .first();
}

/*
 * Scratchログイン開始
 */
async function startScratchAuth(
  request,
  env
) {
  let body;

  try {
    body =
      await request.json();
  } catch {
    return json(
      {
        error:
          "JSONが正しくありません。"
      },
      400
    );
  }

  const username =
    String(
      body?.username || ""
    ).trim();

  if (!username) {
    return json(
      {
        error:
          "Scratchユーザー名を入力してください。"
      },
      400
    );
  }

  const scratchUser =
    await getScratchUser(
      username
    );

  if (!scratchUser) {
    return json(
      {
        error:
          "Scratchユーザーが見つかりません。"
      },
      404
    );
  }

  const code =
    verificationCode();

  const expires =
    new Date(
      Date.now() +
      60 * 60 * 1000
    ).toISOString();

  const challengeId =
    randomId();

  await env.DB.prepare(`
    DELETE FROM verification_challenges
    WHERE scratch_id = ?
  `)
    .bind(
      Number(scratchUser.id)
    )
    .run();

  await env.DB.prepare(`
    INSERT INTO verification_challenges
      (
        id,
        scratch_id,
        username,
        code,
        expires_at
      )
    VALUES (?, ?, ?, ?, ?)
  `)
    .bind(
      challengeId,
      Number(scratchUser.id),
      scratchUser.username,
      code,
      expires
    )
    .run();

  return json({
    ok: true,
    username:
      scratchUser.username,
    scratchId:
      Number(scratchUser.id),
    code,
    expiresAt: expires,
    instruction:
      "このコードをScratchプロフィールの「私について」に入れてください。"
  });
}

/*
 * Scratchプロフィールのコード確認
 */
async function verifyScratchAuth(
  request,
  env
) {
  let body;

  try {
    body =
      await request.json();
  } catch {
    return json(
      {
        error:
          "JSONが正しくありません。"
      },
      400
    );
  }

  const username =
    String(
      body?.username || ""
    ).trim();

  const code =
    String(
      body?.code || ""
    ).trim();

  if (!username || !code) {
    return json(
      {
        error:
          "ユーザー名と確認コードが必要です。"
      },
      400
    );
  }

  const scratchUser =
    await getScratchProfile(
      username
    );

  if (!scratchUser) {
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
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
      LIMIT 1
    `)
      .bind(
        Number(scratchUser.id)
      )
      .first();

  if (!challenge) {
    return json(
      {
        error:
          "確認コードが存在しないか、期限切れです。"
      },
      400
    );
  }

  if (
    String(challenge.code)
      .toUpperCase() !==
    code.toUpperCase()
  ) {
    return json(
      {
        error:
          "確認コードが違います。"
      },
      400
    );
  }

  /*
   * Scratchプロフィールの
   * About Me
   */
  const bio =
    String(
      scratchUser.profile?.bio ||
      ""
    );

  /*
   * コードがプロフィール内の
   * どこかに含まれていればOK
   */
  if (!bio.includes(code)) {
    return json(
      {
        error:
          "Scratchプロフィールの「私について」に確認コードが見つかりません。"
      },
      400
    );
  }

  const user =
    await upsertUser(
      env,
      scratchUser
    );

  const sessionId =
    randomId();

  const expiresAt =
    new Date(
      Date.now() +
      SESSION_DAYS *
      24 *
      60 *
      60 *
      1000
    ).toISOString();

  await env.DB.prepare(`
    INSERT INTO sessions
      (
        id,
        user_id,
        expires_at
      )
    VALUES (?, ?, ?)
  `)
    .bind(
      sessionId,
      user.id,
      expiresAt
    )
    .run();

  await env.DB.prepare(`
    DELETE FROM verification_challenges
    WHERE scratch_id = ?
  `)
    .bind(
      Number(scratchUser.id)
    )
    .run();

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        id: user.id,
        scratch_id:
          user.scratch_id,
        username:
          user.username,
        display_name:
          user.display_name,
        avatar_url:
          user.avatar_url
      }
    }),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Set-Cookie":
          sessionCookie(
            sessionId,
            SESSION_DAYS *
              24 *
              60 *
              60
          )
      }
    }
  );
}

/*
 * ログアウト
 */
async function logout(
  request,
  env
) {
  const sessionId =
    getCookie(
      request,
      SESSION_COOKIE
    );

  if (sessionId) {
    await env.DB.prepare(`
      DELETE FROM sessions
      WHERE id = ?
    `)
      .bind(sessionId)
      .run();
  }

  return new Response(
    JSON.stringify({
      ok: true
    }),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Set-Cookie":
          sessionCookie(
            "",
            0
          )
      }
    }
  );
}

/*
 * 現在のユーザー
 */
async function me(
  request,
  env
) {
  const user =
    await getUser(
      request,
      env
    );

  if (!user) {
    return json(
      {
        user: null
      }
    );
  }

  return json({
    user
  });
}

/*
 * ルーム一覧
 */
async function getRooms(
  request,
  env
) {
  const {
    user,
    response
  } = await requireUser(
    request,
    env
  );

  if (response) {
    return response;
  }

  const result =
    await env.DB.prepare(`
      SELECT
        rooms.id,
        rooms.name,
        rooms.owner_user_id,
        rooms.is_private,
        rooms.created_at,
        users.username AS owner_username
      FROM rooms
      INNER JOIN users
        ON users.id =
          rooms.owner_user_id
      LEFT JOIN room_members
        ON room_members.room_id =
          rooms.id
        AND room_members.user_id =
          ?
      WHERE
        rooms.is_private = 0
        OR room_members.user_id IS NOT NULL
      ORDER BY rooms.created_at DESC
    `)
      .bind(user.id)
      .all();

  return json({
    rooms:
      result.results || []
  });
}

/*
 * ルーム作成
 */
async function createRoom(
  request,
  env
) {
  const {
    user,
    response
  } = await requireUser(
    request,
    env
  );

  if (response) {
    return response;
  }

  let body;

  try {
    body =
      await request.json();
  } catch {
    body = {};
  }

  const name =
    String(
      body?.name ||
      "新しいルーム"
    ).trim();

  const isPrivate =
    body?.is_private ? 1 : 0;

  if (!name) {
    return json(
      {
        error:
          "ルーム名を入力してください。"
      },
      400
    );
  }

  const roomId =
    randomId();

  await env.DB.prepare(`
    INSERT INTO rooms
      (
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
      user.id,
      isPrivate
    )
    .run();

  await env.DB.prepare(`
    INSERT INTO room_members
      (
        room_id,
        user_id
      )
    VALUES (?, ?)
  `)
    .bind(
      roomId,
      user.id
    )
    .run();

  return json({
    ok: true,
    room: {
      id: roomId,
      name,
      owner_user_id:
        user.id,
      is_private:
        isPrivate
    }
  }, 201);
}

/*
 * ルーム参加
 */
async function joinRoom(
  request,
  env,
  roomId
) {
  const {
    user,
    response
  } = await requireUser(
    request,
    env
  );

  if (response) {
    return response;
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

  if (
    room.is_private &&
    room.owner_user_id !==
      user.id
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
    INSERT OR IGNORE INTO room_members
      (
        room_id,
        user_id
      )
    VALUES (?, ?)
  `)
    .bind(
      roomId,
      user.id
    )
    .run();

  return json({
    ok: true,
    room
  });
}

/*
 * ルーム情報
 */
async function getRoom(
  request,
  env,
  roomId
) {
  const {
    user,
    response
  } = await requireUser(
    request,
    env
  );

  if (response) {
    return response;
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

  const member =
    await env.DB.prepare(`
      SELECT *
      FROM room_members
      WHERE room_id = ?
        AND user_id = ?
      LIMIT 1
    `)
      .bind(
        roomId,
        user.id
      )
      .first();

  if (!member) {
    return json(
      {
        error:
          "このルームには参加していません。"
      },
      403
    );
  }

  const messages =
    await env.DB.prepare(`
      SELECT
        messages.id,
        messages.text,
        messages.created_at,
        users.username,
        users.avatar_url
      FROM messages
      INNER JOIN users
        ON users.id =
          messages.user_id
      WHERE messages.room_id = ?
      ORDER BY messages.id DESC
      LIMIT 100
    `)
      .bind(roomId)
      .all();

  return json({
    room,
    messages:
      (messages.results || [])
        .reverse()
  });
}

/*
 * APIルーター
 */
export async function handleApi(
  request,
  env,
  url
) {
  const path =
    url.pathname;

  if (
    request.method === "GET" &&
    path === "/api/me"
  ) {
    return me(
      request,
      env
    );
  }

  if (
    request.method === "POST" &&
    path ===
      "/api/auth/scratch/start"
  ) {
    return startScratchAuth(
      request,
      env
    );
  }

  if (
    request.method === "POST" &&
    path ===
      "/api/auth/scratch/verify"
  ) {
    return verifyScratchAuth(
      request,
      env
    );
  }

  if (
    request.method === "POST" &&
    path ===
      "/api/auth/logout"
  ) {
    return logout(
      request,
      env
    );
  }

  if (
    request.method === "GET" &&
    path === "/api/rooms"
  ) {
    return getRooms(
      request,
      env
    );
  }

  if (
    request.method === "POST" &&
    path === "/api/rooms"
  ) {
    return createRoom(
      request,
      env
    );
  }

  const joinMatch =
    path.match(
      /^\/api\/rooms\/([^/]+)\/join$/
    );

  if (
    joinMatch &&
    request.method === "POST"
  ) {
    return joinRoom(
      request,
      env,
      decodeURIComponent(
        joinMatch[1]
      )
    );
  }

  const roomMatch =
    path.match(
      /^\/api\/rooms\/([^/]+)$/
    );

  if (
    roomMatch &&
    request.method === "GET"
  ) {
    return getRoom(
      request,
      env,
      decodeURIComponent(
        roomMatch[1]
      )
    );
  }

  if (
    request.method === "GET" &&
    path ===
      "/api/auth/scratch-user"
  ) {
    const username =
      url.searchParams.get(
        "username"
      );

    if (!username) {
      return json(
        {
          error:
            "usernameが必要です。"
        },
        400
      );
    }

    const scratchUser =
      await getScratchUser(
        username
      );

    if (!scratchUser) {
      return json(
        {
          error:
            "ユーザーが見つかりません。"
        },
        404
      );
    }

    return json({
      user: scratchUser
    });
  }

  return json(
    {
      error:
        "API endpoint not found."
    },
    404
  );
}
