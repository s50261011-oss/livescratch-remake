// extension/background/cloudflareSocket.js

class CloudflareSocket {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;

    this.ws = null;
    this.connected = false;

    this.listeners = new Map();
    this.pendingConnect = null;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    this.listeners.get(event).push(callback);

    return this;
  }

  off(event, callback) {
    const list = this.listeners.get(event);

    if (!list) {
      return this;
    }

    const index = list.indexOf(callback);

    if (index !== -1) {
      list.splice(index, 1);
    }

    return this;
  }

  emit(event, ...args) {
    if (event === "connect") {
      return this.connect();
    }

    if (event === "disconnect") {
      return this.disconnect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return this;
    }

    const message = {
      type: event,
      data: args
    };

    this.ws.send(JSON.stringify(message));

    return this;
  }

  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return this;
    }

    this.ws.send(
      typeof data === "string"
        ? data
        : JSON.stringify(data)
    );

    return this;
  }

  connect() {
    if (
      this.ws &&
      (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      )
    ) {
      return this;
    }

    if (this.pendingConnect) {
      return this;
    }

    this.pendingConnect = true;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.addEventListener("open", () => {
        this.pendingConnect = false;
        this.connected = true;

        this.dispatch("connect");
      });

      this.ws.addEventListener("message", event => {
        this.handleMessage(event.data);
      });

      this.ws.addEventListener("close", () => {
        this.pendingConnect = false;
        this.connected = false;

        this.dispatch("disconnect");
      });

      this.ws.addEventListener("error", error => {
        this.dispatch("connect_error", error);
      });
    } catch (error) {
      this.pendingConnect = false;
      this.connected = false;

      this.dispatch("connect_error", error);
    }

    return this;
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }

    this.ws = null;
    this.connected = false;

    return this;
  }

  handleMessage(raw) {
    let message;

    try {
      message =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw;
    } catch {
      return;
    }

    if (!message) {
      return;
    }

    /*
     * Cloudflare側から
     *
     * {
     *   type: "chat",
     *   ...
     * }
     *
     * のように届く場合
     */
    if (message.type) {
      this.dispatch(message.type, message);
    }

    /*
     * 元LiveScratch互換の
     * "message" イベント
     */
    this.dispatch("message", message);
  }

  dispatch(event, ...args) {
    const list = this.listeners.get(event);

    if (!list) {
      return;
    }

    for (const callback of [...list]) {
      try {
        callback(...args);
      } catch (error) {
        console.error(
          `[CloudflareSocket] ${event} handler error`,
          error
        );
      }
    }
  }
}

self.CloudflareSocket = CloudflareSocket;
