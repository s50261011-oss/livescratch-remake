// backend/WebSockets.js

export default class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.sockets = new Map();
  }

  async fetch(request) {
    if (
      request.headers.get("Upgrade")?.toLowerCase() !==
      "websocket"
    ) {
      return new Response(
        "WebSocket connection required.",
        { status: 426 }
      );
    }

    const roomId =
      request.headers.get("X-Room-Id");

    const userId =
      request.headers.get("X-User-Id");

    const username =
      request.headers.get("X-Username");

    const scratchId =
      request.headers.get("X-Scratch-Id");

    if (!roomId || !userId || !username) {
      return new Response(
        "Authentication information is missing.",
        { status: 401 }
      );
    }

    const pair = new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    server.accept();

    const socketId = crypto.randomUUID();

    const user = {
      socketId,
      userId: Number(userId),
      scratchId: scratchId
        ? Number(scratchId)
        : null,
      username
    };

    this.sockets.set(socketId, {
      socket: server,
      user
    });

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
        this.removeSocket(socketId);
      }
    );

    server.addEventListener(
      "error",
      () => {
        this.removeSocket(socketId);
      }
    );

    this.send(server, {
      type: "connected",
      roomId,
      user
    });

    this.broadcast({
      type: "presence",
      action: "join",
      user
    }, socketId);

    this.sendMembers();

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
    } catch (error) {
      console.error(
        "WebSocket send error:",
        error
      );
    }
  }

  broadcast(data, exceptSocketId = null) {
    for (
      const [
        socketId,
        connection
      ] of this.sockets
    ) {
      if (
        socketId === exceptSocketId
      ) {
        continue;
      }

      this.send(
        connection.socket,
        data
      );
    }
  }

  sendMembers() {
    const members = [];

    for (
      const connection of this.sockets.values()
    ) {
      members.push(
        connection.user
      );
    }

    const message = {
      type: "members",
      members
    };

    for (
      const connection of this.sockets.values()
    ) {
      this.send(
        connection.socket,
        message
      );
    }
  }

  removeSocket(socketId) {
    const connection =
      this.sockets.get(socketId);

    if (!connection) {
      return;
    }

    this.sockets.delete(socketId);

    this.broadcast({
      type: "presence",
      action: "leave",
      user: connection.user
    });

    this.sendMembers();
  }

  getConnection(socketId) {
    return this.sockets.get(
      socketId
    );
  }

  handleMessage(socketId, raw) {
    let data;

    try {
      data =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw;
    } catch {
      return;
    }

    if (!data || typeof data !== "object") {
      return;
    }

    const connection =
      this.getConnection(socketId);

    if (!connection) {
      return;
    }

    const user =
      connection.user;

    /*
     * 元LiveScratch互換
     */
    switch (data.type) {
      case "joinSession":
        this.handleJoinSession(
          socketId,
          data
        );
        break;

      case "joinSessions":
        this.handleJoinSessions(
          socketId,
          data
        );
        break;

      case "leaveSession":
        this.handleLeaveSession(
          socketId,
          data
        );
        break;

      case "projectChange":
        this.handleProjectChange(
          socketId,
          data
        );
        break;

      case "setTitle":
        this.handleSetTitle(
          socketId,
          data
        );
        break;

      case "setCursor":
        this.handleSetCursor(
          socketId,
          data
        );
        break;

      case "chat":
        this.handleChat(
          socketId,
          data
        );
        break;

      /*
       * 音声通話用
       */
      case "voice-offer":
      case "voice-answer":
      case "voice-ice":
        this.handleVoiceSignal(
          socketId,
          data
        );
        break;

      case "voice-state":
        this.handleVoiceState(
          socketId,
          data
        );
        break;

      /*
       * TurboWarp関連
       */
      case "turbowarp":
        this.broadcast(
          {
            type: "turbowarp",
            from: user,
            data: data.data
          },
          socketId
        );
        break;

      /*
       * 接続確認
       */
      case "ping":
        this.send(
          connection.socket,
          {
            type: "pong",
            time: Date.now()
          }
        );
        break;

      default:
        console.log(
          "Unknown WebSocket message:",
          data.type
        );
        break;
    }
  }

  /*
   * LiveScratch:
   * joinSession
   */
  handleJoinSession(socketId, data) {
    const connection =
      this.getConnection(socketId);

    if (!connection) {
      return;
    }

    const id =
      data.id ?? data.blId;

    if (!id) {
      return;
    }

    if (!connection.sessions) {
      connection.sessions =
        new Set();
    }

    connection.sessions.add(
      String(id)
    );

    this.send(
      connection.socket,
      {
        type: "sessionJoined",
        id: String(id)
      }
    );
  }

  /*
   * LiveScratch:
   * joinSessions
   */
  handleJoinSessions(socketId, data) {
    const connection =
      this.getConnection(socketId);

    if (!connection) {
      return;
    }

    if (!connection.sessions) {
      connection.sessions =
        new Set();
    }

    const ids =
      Array.isArray(data.ids)
        ? data.ids
        : [];

    for (const id of ids) {
      if (id == null) {
        continue;
      }

      connection.sessions.add(
        String(id)
      );
    }

    this.send(
      connection.socket,
      {
        type: "sessionsJoined",
        ids: ids.map(String)
      }
    );
  }

  /*
   * LiveScratch:
   * leaveSession
   */
  handleLeaveSession(socketId, data) {
    const connection =
      this.getConnection(socketId);

    if (!connection) {
      return;
    }

    if (!connection.sessions) {
      return;
    }

    const id =
      data.id ?? data.blId;

    if (id == null) {
      return;
    }

    connection.sessions.delete(
      String(id)
    );
  }

  /*
   * LiveScratch:
   * projectChange
   */
  handleProjectChange(socketId, data) {
    const connection =
      this.getConnection(socketId);

    if (!connection) {
      return;
    }

    const blId =
      data.blId ?? data.id;

    if (!blId) {
      return;
    }

    this.broadcast(
      {
        type: "projectChange",
        blId: String(blId),
        version:
          data.version ?? null,
        msg: data.msg,
        from: socketId,
        user:
          connection.user.username
      },
      socketId
    );
  }

  /*
   * LiveScratch:
   * setTitle
   */
  handleSetTitle(socketId, data) {
    const connection =
      this.getConnection(socketId);

    if (!connection) {
      return;
    }

    const blId =
      data.blId ?? data.id;

    this.broadcast(
      {
        type: "setTitle",
        blId:
          blId != null
            ? String(blId)
            : null,
        msg: data.msg,
        from: socketId,
        user:
          connection.user.username
      },
      socketId
    );
  }

  /*
   * LiveScratch:
   * setCursor
   */
  handleSetCursor(socketId, data) {
    const connection =
      this.getConnection(socketId);

    if (!connection) {
      return;
    }

    const blId =
      data.blId ?? data.id;

    this.broadcast(
      {
        type: "setCursor",
        blId:
          blId != null
            ? String(blId)
            : null,
        cursor: data.cursor,
        from: socketId,
        user:
          connection.user.username
      },
      socketId
    );
  }

  /*
   * リアルタイムチャット
   */
  async handleChat(socketId, data) {
    const connection =
      this.getConnection(socketId);

    if (!connection) {
      return;
    }

    let text = "";

    if (
      data.msg &&
      data.msg.msg &&
      typeof data.msg.msg.text !==
        "undefined"
    ) {
      text =
        String(data.msg.msg.text);
    } else if (
      data.msg &&
      typeof data.msg.text !==
        "undefined"
    ) {
      text =
        String(data.msg.text);
    } else if (
      typeof data.text !==
        "undefined"
    ) {
      text =
        String(data.text);
    }

    if (!text.trim()) {
      return;
    }

    const message = {
      type: "chat",
      blId:
        data.blId ?? null,
      msg: {
        msg: {
          text,
          sender:
            connection.user.username
        }
      },
      user:
        connection.user.username,
      createdAt: Date.now()
    };

    this.broadcast(
      message
    );

    /*
     * D1にも保存
     */
    try {
      const roomId =
        data.roomId ??
        this.state.id.toString();

      if (this.env.DB) {
        await this.env.DB.prepare(`
          INSERT INTO messages
            (room_id, user_id, text)
          VALUES (?, ?, ?)
        `)
          .bind(
            roomId,
            connection.user.userId,
            text
          )
          .run();
      }
    } catch (error) {
      console.error(
        "Failed to save chat:",
        error
      );
    }
  }

  /*
   * WebRTCシグナリング
   */
  handleVoiceSignal(socketId, data) {
    const connection =
      this.getConnection(socketId);

    if (!connection) {
      return;
    }

    this.broadcast(
      {
        type: data.type,
        from: connection.user,
        data: data.data
      },
      socketId
    );
  }

  /*
   * マイクON/OFFなど
   */
  handleVoiceState(socketId, data) {
    const connection =
      this.getConnection(socketId);

    if (!connection) {
      return;
    }

    this.broadcast(
      {
        type: "voice-state",
        from: connection.user,
        state: data.state
      },
      socketId
    );
  }
}
