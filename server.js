const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8080 });

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on("connection", (ws) => {
  ws.clientId = null;
  ws.userId = null;
  ws.pageKey = null;
  ws.sessionId = null;

  ws.on("message", (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      ws.clientId = msg.clientId;
      ws.userId = msg.userId;
      ws.pageKey = msg.pageKey;
      return;
    }

    if (msg.type === "assist-request") {
      for (const client of wss.clients) {
        if (
          client !== ws &&
          client.readyState === WebSocket.OPEN &&
          client.pageKey === ws.pageKey
        ) {
          send(client, msg);
        }
      }

      return;
    }

    if (msg.type === "assist-response") {
      for (const client of wss.clients) {
        if (
          client.readyState === WebSocket.OPEN &&
          client.clientId === msg.toClientId
        ) {
          send(client, msg);

          if (msg.accepted) {
            client.sessionId = msg.sessionId;
            ws.sessionId = msg.sessionId;
          }
        }
      }

      return;
    }

    if (
      msg.type === "mouse-event" ||
      msg.type === "wheel-event" ||
      msg.type === "scroll-event"
    ) {
      if (!ws.sessionId) return;

      for (const client of wss.clients) {
        if (
          client !== ws &&
          client.readyState === WebSocket.OPEN &&
          client.sessionId === ws.sessionId
        ) {
          send(client, msg);
        }
      }
    }
  });

  ws.on("close", () => {
    console.log("client closed:", ws.clientId);
  });
});

console.log("ScreenMax sync server running at ws://localhost:8080");
