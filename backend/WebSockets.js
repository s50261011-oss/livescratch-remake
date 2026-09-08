export default class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.sockets = new Map();

    /*
     * Durable Objectごとに対応する
     * roomIdを保存する
     */
    this.roomId = null;
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

    /*
     * src/index.jsから渡されたルームID
     */
    this.roomId =
      request.headers.get(
        "X-Room-Id"
      );

    const userId =
      request.headers.get(
        "X-User-Id"
      );

    const username =
      request.headers.get(
        "X-Username"
      );

    if (
      !this.roomId ||
      !userId ||
      !username
    ) {
      return new Response(
        "Authentication required",
        {
          status: 401
        }
      );
    }

    const pair =
      new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    server.accept();

    const socketId =
      crypto.randomUUID();

    this.sockets.set(
      socketId,
      {
        socket: server,
        userId: String(userId),
        username: String(username)
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
        const current =
          this.sockets.get(socketId);

        this.sockets.delete(
          socketId
        );

        if (current) {
          this.broadcast({
            type: "presence",
            action: "leave",
            username:
              current.username
          });
        }
      }
    );

    server.addEventListener(
      "error",
      () => {
        this.sockets.delete(
          socketId
        );
      }
    );

    /*
     * 接続完了
     */
    this.send(
      server,
      {
        type: "connected",
        username
      }
    );

    /*
     * 現在いるユーザーを送る
     */
    this.send(
      server,
      {
        type: "members",
        members:
          [...this.sockets.values()]
            .map(socket => ({
              userId:
                socket.userId,
              username:
                socket.username
            }))
      }
    );

    /*
     * 他のユーザーへ入室通知
     */
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

    for (
      const [
        socketId,
        client
      ] of this.sockets
    ) {
      try {
        client.socket.send(
          message
        );
      } catch {
        this.sockets.delete(
          socketId
        );
      }
    }
  }

  async handleMessage(
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
    if (
      data.type === "chat"
    ) {
      const text =
        String(data.text || "")
          .trim();

      if (!text) {
        return;
      }

      if (text.length > 2000) {
        return;
      }

      const message = {
        type: "chat",
        username:
          client.username,
        text,
        timestamp:
          Date.now()
      };

      /*
       * 全員へリアルタイム送信
       */
      this.broadcast(message);

      /*
       * D1にも保存
       */
      if (this.roomId) {
        try {
          await this.env.DB.prepare(`
            INSERT INTO messages (
              id,
              room_id,
              user_id,
              text,
              created_at
            )
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          `)
            .bind(
              crypto.randomUUID(),
              this.roomId,
              client.userId,
              text
            )
            .run();
        } catch {
          /*
           * チャット表示自体は
           * D1保存失敗で止めない
           */
        }
      }

      return;
    }

    /*
     * WebRTC offer / answer / ICE
     */
    if (
      data.type ===
        "voice-offer" ||
      data.type ===
        "voice-answer" ||
      data.type ===
        "voice-ice"
    ) {
      const target =
        String(
          data.target || ""
        );

      if (!target) {
        return;
      }

      const targetClient =
        [...this.sockets.values()]
          .find(
            socket =>
              socket.username ===
              target
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
      data.type ===
      "voice-state"
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
      data.type ===
      "turbowarp"
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

    /*
     * ping
     */
    if (
      data.type === "ping"
    ) {
      this.send(
        client.socket,
        {
          type: "pong",
          timestamp:
            Date.now()
        }
      );

      return;
    }
  }
}
