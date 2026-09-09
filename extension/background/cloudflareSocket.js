// extension/background/cloudflareSocket.js

class CloudflareSocket {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;

    this.ws = null;
    this.connected = false;
    this.connecting = false;

    this.listeners = new Map();
    this.pendingCallbacks = [];
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

    if (this.connecting) {
      return this;
    }

    this.connecting = true;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.addEventListener("open", () => {
        this.connecting = false;
        this.connected = true;

        this.dispatch("connect");
      });

      this.ws.addEventListener("message", event => {
        this.handleMessage(event.data);
      });

      this.ws.addEventListener("close", event => {
        this.connecting = false;
        this.connected = false;

        this.dispatch("disconnect", event);
      });

      this.ws.addEventListener("error", error => {
        this.dispatch("connect_error", error);
      });

    } catch (error) {
      this.connecting = false;
      this.connected = false;

      this.dispatch("connect_error", error);
    }

    return this;
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        console.error(
          "[CloudflareSocket] close error",
          error
        );
      }
    }

    this.ws = null;
    this.connected = false;
    this.connecting = false;

    return this;
  }

  send(data, callback) {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      if (typeof callback === "function") {
        callback({
          error: "WebSocket is not connected."
        });
      }

      return this;
    }

    try {
      this.ws.send(
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      );

      /*
       * 元LiveScratchでは、
       *
       * socket.send(data, callback)
       *
       * の形が使われています。
       *
       * Cloudflare WebSocketではSocket.IOの
       * ACKがないため、ここでは送信成功時に
       * callbackを呼びます。
       */
      if (typeof callback === "function") {
        callback(null);
      }

    } catch (error) {
      console.error(
        "[CloudflareSocket] send error",
        error
      );

      if (typeof callback === "function") {
        callback({
          error: error.message
        });
      }
    }

    return this;
  }

  emit(event, ...args) {
    /*
     * connect / disconnect は
     * Socket.IO互換として扱う。
     */
    if (event === "connect") {
      return this.connect();
    }

    if (event === "disconnect") {
      return this.disconnect();
    }

    /*
     * Cloudflare WebSocketへ送信。
     */
    return this.send({
      type: event,
      data: args
    });
  }

  handleMessage(raw) {
    let message;

    try {
      message =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw;
    } catch (error) {
      console.error(
        "[CloudflareSocket] invalid message",
        error
      );

      return;
    }

    if (!message) {
      return;
    }

    /*
     * typeごとのイベント
     *
     * 例:
     * {
     *   type: "projectChange",
     *   ...
     * }
     */
    if (message.type) {
      this.dispatch(message.type, message);
    }

    /*
     * 元LiveScratchが使用する
     * socket.on("message", ...)
     */
    this.dispatch("message", message);
  }
}

self.CloudflareSocket = CloudflareSocket;
