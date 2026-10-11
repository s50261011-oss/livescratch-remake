const SESSION_COOKIE = "ls_session";
const SESSION_DAYS = 30;
const CODE_MINUTES = 10;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra }
  });
}

function cors(request) {
  const origin = request.headers.get("Origin");
  const allowed = origin || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Vary": "Origin"
  };
}

function withCors(response, request) {
  const h = new Headers(response.headers);
  Object.entries(cors(request)).forEach(([k, v]) => h.set(k, v));
  return new Response(response.body, { status: response.status, headers: h });
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function safeUser(row) {
  return {
    id: row.id,
    accountName: row.account_name,
    username: row.display_name,
    scratchUsername: row.scratch_username,
    avatar: row.avatar,
    bio: row.bio,
    language: row.language,
    theme: row.theme
  };
}

async function currentUser(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(hash, Date.now()).first();
  return row || null;
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new Response(JSON.stringify({ error: "ログインが必要です。" }), { status: 401 });
  return user;
}

async function requestLogin(request, env) {
  const body = await request.json();
  const accountName = String(body.accountName || "").trim();
  if (!accountName || accountName.length > 64) return json({ error: "アカウント名が不正です。" }, 400);

  let user = await env.DB.prepare("SELECT * FROM users WHERE account_name = ?").bind(accountName).first();
  const now = Date.now();
  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO users
      (id, account_name, display_name, scratch_username, created_at)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(id, accountName, accountName, accountName, now).run();
    user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  }

  const code = randomCode();
  const expiresAt = now + CODE_MINUTES * 60 * 1000;
  await env.DB.prepare(`INSERT INTO login_codes
    (id, account_name, code_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), accountName, await sha256(code), expiresAt, now).run();

  // 本番ではここをメール/SMS等の認証コード送信サービスに置き換える。
  const result = { ok: true, expiresAt };
  if (env.DEV_MODE === "true") result.devCode = code;
  return json(result);
}

async function verifyLogin(request, env) {
  const body = await request.json();
  const accountName = String(body.accountName || "").trim();
  const code = String(body.code || "").trim();
  if (!accountName || !/^\d{6}$/.test(code)) return json({ error: "認証コードが不正です。" }, 400);

  const row = await env.DB.prepare(`SELECT * FROM login_codes
    WHERE account_name = ? AND used = 0 ORDER BY created_at DESC LIMIT 1`).bind(accountName).first();
  if (!row || row.expires_at <= Date.now()) return json({ error: "コードの有効期限が切れています。" }, 400);
  if (row.attempts >= 5) return json({ error: "試行回数の上限に達しました。もう一度コードを発行してください。" }, 429);

  const hash = await sha256(code);
  if (hash !== row.code_hash) {
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    return json({ error: "認証コードが違います。" }, 400);
  }

  await env.DB.prepare("UPDATE login_codes SET used = 1 WHERE id = ?").bind(row.id).run();
  const user = await env.DB.prepare("SELECT * FROM users WHERE account_name = ?").bind(accountName).first();
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256(token);
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, user.id, expiresAt, Date.now()).run();

  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return json({ ok: true, user: safeUser(user) }, 200, { "Set-Cookie": cookie });
}

async function me(request, env) {
  const user = await currentUser(request, env);
  return user ? json({ loggedIn: true, user: safeUser(user) }) : json({ loggedIn: false });
}

async function updateMe(request, env) {
  const user = await requireUser(request, env);
  const body = await request.json();
  const username = String(body.username ?? user.display_name).trim().slice(0, 64) || user.display_name;
  const avatar = String(body.avatar ?? user.avatar).slice(0, 8) || "🙂";
  const bio = String(body.bio ?? user.bio).slice(0, 500);
  const language = ["ja", "en"].includes(body.language) ? body.language : user.language;
  const theme = ["black", "red", "blue", "white", "rainbow"].includes(body.theme) ? body.theme : user.theme;
  await env.DB.prepare(`UPDATE users SET display_name=?, avatar=?, bio=?, language=?, theme=? WHERE id=?`)
    .bind(username, avatar, bio, language, theme, user.id).run();
  const updated = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first();
  return json({ ok: true, user: safeUser(updated) });
}

async function logout(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
  const cookie = `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
}

async function router(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  const url = new URL(request.url);
  if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, service: "livescratch-remake-api" });
  if (url.pathname === "/api/auth/request" && request.method === "POST") return requestLogin(request, env);
  if (url.pathname === "/api/auth/verify" && request.method === "POST") return verifyLogin(request, env);
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
  if (url.pathname === "/api/me" && request.method === "GET") return me(request, env);
  if (url.pathname === "/api/me" && request.method === "PUT") return updateMe(request, env);
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return withCors(await router(request, env), request);
    } catch (error) {
      if (error instanceof Response) return withCors(error, request);
      return withCors(json({ error: "サーバーエラーが発生しました。" }, 500), request);
    }
  }
};
