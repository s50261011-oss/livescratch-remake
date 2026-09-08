export default class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map();
  }

  async fetch(request) {
    if (
      request.headers.get("Upgrade")
        ?.toLowerCase() !== "websocket"
    ) {
      return new Response(
        "WebSocket endpoint",
        {
          status: 426
        }
      );
    }

    const pair = new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    const userId =
      request.headers.get("X-User-Id");

    const username =
      request.headers.get("X-Username");

    if (!userId || !username) {
      server.close(
        1008,
        "Authentication required"
      );

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    server.accept();

    const socketId =
      crypto.randomUUID();

    this.sockets.set(
      socketId,
      {
        socket: server,
        userId,
        username
      }
    );

    server.addEventListener(
      "message",
      event => {
        this.handleMessage(
          socketId,
          event.data
        );
      }
    );

    server.addEventListener(
      "close",
      () => {
        this.sockets.delete(socketId);

        this.broadcast({
          type: "presence",
          action: "leave",
          username
        });
      }
    );

    server.addEventListener(
      "error",
      () => {
        this.sockets.delete(socketId);
      }
    );

    this.send(
      server,
      {
        type: "connected",
        username
      }
    );

    this.broadcast({
      type: "presence",
      action: "join",
      username
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  send(socket, data) {
    try {
      socket.send(
        JSON.stringify(data)
      );
    } catch {
      // 接続切れ
    }
  }

  broadcast(data) {
    const message =
      JSON.stringify(data);

    for (const [
      socketId,
      client
    ] of this.sockets) {
      try {
        client.socket.send(message);
      } catch {
        this.sockets.delete(
          socketId
        );
      }
    }
  }

  handleMessage(
    socketId,
    raw
  ) {
    let data;

    try {
      data =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw;
    } catch {
      return;
    }

    if (
      !data ||
      typeof data.type !== "string"
    ) {
      return;
    }

    const client =
      this.sockets.get(socketId);

    if (!client) {
      return;
    }

    /*
     * チャット
     */
    if (data.type === "chat") {
      const text =
        String(data.text || "")
          .trim();

      if (!text) return;

      this.broadcast({
        type: "chat",
        username:
          client.username,
        text,
        timestamp:
          Date.now()
      });

      return;
    }

    /*
     * WebRTCシグナリング
     */
    if (
      data.type === "voice-offer" ||
      data.type === "voice-answer" ||
      data.type === "voice-ice"
    ) {
      const target =
        String(data.target || "");

      const targetClient =
        [...this.sockets.values()]
          .find(
            socket =>
              socket.username === target
          );

      if (!targetClient) {
        return;
      }

      this.send(
        targetClient.socket,
        {
          ...data,
          from:
            client.username
        }
      );

      return;
    }

    /*
     * ボイス状態
     */
    if (
      data.type === "voice-state"
    ) {
      this.broadcast({
        type: "voice-state",
        username:
          client.username,
        enabled:
          Boolean(data.enabled)
      });

      return;
    }

    /*
     * TurboWarp同期
     */
    if (
      data.type === "turbowarp"
    ) {
      this.broadcast({
        type: "turbowarp",
        username:
          client.username,
        data:
          data.data
      });

      return;
    }
  }
}
