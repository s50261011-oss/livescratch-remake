export default class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.sockets = new Map();

    /*
     * Durable Objectごとに対応するroomId
     */
    this.roomId = null;

    /*
     * LiveScratch互換のプロジェクト状態
     *
     * {
     *   title: "...",
     *   version: 0,
     *   changes: []
     * }
     */
    this.project = {
      title: "",
      version: 0,
      changes: []
    };
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
     * Workerから渡される情報
     */
    this.roomId =
      request.headers.get("X-Room-Id");

    const userId =
      request.headers.get("X-User-Id");

    const username =
      request.headers.get("X-Username");

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

    const socketInfo = {
      socket: server,
      userId: String(userId),
      username: String(username),

      /*
       * この接続が参加している
       * LiveScratchセッション
       */
      sessions: new Set()
    };

    this.sockets.set(
      socketId,
      socketInfo
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

        this.sockets.delete(socketId);

        if (current) {
          /*
           * 参加中セッションから離脱
           */
          for (
            const sessionId of current.sessions
          ) {
            this.broadcastToSession(
              sessionId,
              {
                type: "member_leave",
                username:
                  current.username,
                userId:
                  current.userId
              }
            );
          }

          /*
           * 新システム側のpresence
           */
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
        this.sockets.delete(socketId);
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
     * 現在のメンバー
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
     * 他ユーザーへ入室通知
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

  /*
   * --------------------------------------------------
   * 基本送信
   * --------------------------------------------------
   */

  send(socket, data) {
    try {
      if (
        socket.readyState ===
        WebSocket.OPEN
      ) {
        socket.send(
          JSON.stringify(data)
        );
      }
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
        if (
          client.socket.readyState ===
          WebSocket.OPEN
        ) {
          client.socket.send(message);
        }
      } catch {
        this.sockets.delete(
          socketId
        );
      }
    }
  }

  /*
   * 特定のLiveScratchセッションだけへ送信
   */
  broadcastToSession(
    sessionId,
    data,
    exceptSocketId = null
  ) {
    const message =
      JSON.stringify(data);

    for (
      const [
        socketId,
        client
      ] of this.sockets
    ) {
      if (
        socketId ===
        exceptSocketId
      ) {
        continue;
      }

      if (
        !client.sessions.has(
          sessionId
        )
      ) {
        continue;
      }

      try {
        if (
          client.socket.readyState ===
          WebSocket.OPEN
        ) {
          client.socket.send(message);
        }
      } catch {
        this.sockets.delete(
          socketId
        );
      }
    }
  }

  /*
   * --------------------------------------------------
   * メッセージ処理
   * --------------------------------------------------
   */

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
     * ------------------------------------------------
     * 元LiveScratch互換
     * ------------------------------------------------
     */

    /*
     * joinSession
     *
     * 1つのLiveScratchプロジェクトへ参加
     */
    if (
      data.type ===
      "joinSession"
    ) {
      const sessionId =
        this.getSessionId(data);

      if (!sessionId) {
        return;
      }

      client.sessions.add(
        sessionId
      );

      /*
       * 現在の参加者を本人へ通知
       */
      const members =
        [...this.sockets.values()]
          .filter(socket =>
            socket.sessions.has(
              sessionId
            )
          )
          .map(socket => ({
            userId:
              socket.userId,
            username:
              socket.username
          }));

      this.send(
        client.socket,
        {
          type: "sessionJoined",
          sessionId,
          members
        }
      );

      /*
       * 他の参加者へ通知
       */
      this.broadcastToSession(
        sessionId,
        {
          type: "member_join",
          sessionId,
          userId:
            client.userId,
          username:
            client.username
        },
        socketId
      );

      /*
       * 現在のプロジェクト情報
       */
      this.send(
        client.socket,
        {
          type: "yourVersion",
          sessionId,
          version:
            this.project.version
        }
      );

      return;
    }

    /*
     * joinSessions
     *
     * 複数プロジェクトへ一括参加
     */
    if (
      data.type ===
      "joinSessions"
    ) {
      const sessions =
        Array.isArray(
          data.sessions
        )
          ? data.sessions
          : [];

      for (
        const session of sessions
      ) {
        const sessionId =
          typeof session === "string"
            ? session
            : (
                session?.id ??
                session?.sessionId
              );

        if (!sessionId) {
          continue;
        }

        client.sessions.add(
          String(sessionId)
        );
      }

      /*
       * 元LiveScratch側が
       * 接続成功を受け取れるようにする
       */
      this.send(
        client.socket,
        {
          type: "sessionsJoined",
          sessions:
            [...client.sessions]
        }
      );

      return;
    }

    /*
     * leaveSession
     */
    if (
      data.type ===
      "leaveSession"
    ) {
      const sessionId =
        this.getSessionId(data);

      if (!sessionId) {
        return;
      }

      client.sessions.delete(
        sessionId
      );

      this.broadcastToSession(
        sessionId,
        {
          type: "member_leave",
          sessionId,
          userId:
            client.userId,
          username:
            client.username
        }
      );

      return;
    }

    /*
     * projectChange
     *
     * Scratchプロジェクトの変更を
     * 同じセッションのユーザーへ転送
     */
    if (
      data.type ===
      "projectChange"
    ) {
      const sessionId =
        this.getSessionId(data);

      if (!sessionId) {
        return;
      }

      client.sessions.add(
        sessionId
      );

      const version =
        Number.isFinite(
          Number(data.version)
        )
          ? Number(data.version)
          : this.project.version + 1;

      this.project.version =
        Math.max(
          this.project.version,
          version
        );

      const change = {
        type:
          "projectChange",
        sessionId,
        username:
          client.username,
        userId:
          client.userId,
        version:
          this.project.version,

        /*
         * 元LiveScratchから来る
         * 実際の変更データをそのまま保持
         */
        data:
          data.data ??
          data.change ??
          data.projectChange
      };

      /*
       * 同じセッションへ送信
       *
       * 自分自身には返さない。
       */
      this.broadcastToSession(
        sessionId,
        change,
        socketId
      );

      return;
    }

    /*
     * setTitle
     */
    if (
      data.type ===
      "setTitle"
    ) {
      const sessionId =
        this.getSessionId(data);

      const title =
        String(
          data.title ?? ""
        ).slice(0, 200);

      if (sessionId) {
        this.broadcastToSession(
          sessionId,
          {
            type:
              "setTitle",
            sessionId,
            username:
              client.username,
            title
          },
          socketId
        );
      }

      /*
       * 新システム側にも反映
       */
      this.project.title =
        title;

      return;
    }

    /*
     * setCursor
     *
     * 他ユーザーのカーソル位置
     */
    if (
      data.type ===
      "setCursor"
    ) {
      const sessionId =
        this.getSessionId(data);

      if (!sessionId) {
        return;
      }

      this.broadcastToSession(
        sessionId,
        {
          type:
            "setCursor",
          sessionId,
          username:
            client.username,
          userId:
            client.userId,
          cursor:
            data.cursor ??
            data.data ??
            null
        },
        socketId
      );

      return;
    }

    /*
     * ------------------------------------------------
     * 新LiveScratch機能
     * ------------------------------------------------
     */

    /*
     * チャット
     */
    if (
      data.type ===
      "chat"
    ) {
      const text =
        String(
          data.text || ""
        ).trim();

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
        userId:
          client.userId,
        text,
        timestamp:
          Date.now()
      };

      this.broadcast(message);

      /*
       * D1保存
       *
       * messages.id は INTEGER AUTOINCREMENT
       * なのでUUIDを入れない。
       */
      if (this.roomId) {
        try {
          await this.env.DB.prepare(`
            INSERT INTO messages (
              room_id,
              user_id,
              text,
              created_at
            )
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          `)
            .bind(
              this.roomId,
              Number(client.userId),
              text
            )
            .run();
        } catch {
          /*
           * チャット表示は
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
        type:
          "voice-state",
        username:
          client.username,
        enabled:
          Boolean(
            data.enabled
          )
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
        type:
          "turbowarp",
        username:
          client.username,
        userId:
          client.userId,
        data:
          data.data
      });

      return;
    }

    /*
     * ping
     */
    if (
      data.type ===
      "ping"
    ) {
      this.send(
        client.socket,
        {
          type:
            "pong",
          timestamp:
            Date.now()
        }
      );

      return;
    }
  }

  /*
   * sessionIdをいろんな形式から取得
   */
  getSessionId(data) {
    if (
      data.sessionId !==
      undefined
    ) {
      return String(
        data.sessionId
      );
    }

    if (
      data.id !==
      undefined
    ) {
      return String(
        data.id
      );
    }

    if (
      data.lsId !==
      undefined
    ) {
      return String(
        data.lsId
      );
    }

    return null;
  }
}
      return;
    }
  }
}
