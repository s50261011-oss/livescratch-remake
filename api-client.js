// LiveScratch-remake frontend API client.
// Deploy the Worker, then set window.LS_API_BASE before loading app.js.
window.LS_API_BASE = window.LS_API_BASE || "";

async function lsApi(path, options = {}) {
  const response = await fetch(window.LS_API_BASE + path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

window.LiveScratchAPI = {
  requestCode: accountName => lsApi("/api/auth/request", { method: "POST", body: JSON.stringify({ accountName }) }),
  verifyCode: (accountName, code) => lsApi("/api/auth/verify", { method: "POST", body: JSON.stringify({ accountName, code }) }),
  me: () => lsApi("/api/me"),
  updateMe: user => lsApi("/api/me", { method: "PUT", body: JSON.stringify(user) }),
  logout: () => lsApi("/api/auth/logout", { method: "POST", body: "{}" })
};
