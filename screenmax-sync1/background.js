const WS_URL = "ws://localhost:8080";

const connections = new Map();

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizePageKey(url) {
  return url || "";
}

async function getUserId() {
  const stored = await chrome.storage.local.get("screenmaxUserId");

  if (stored.screenmaxUserId) {
    return stored.screenmaxUserId;
  }

  const userId = createId("user");
  await chrome.storage.local.set({ screenmaxUserId: userId });
  return userId;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function isSupportedTabUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function waitForOpen(conn) {
  if (conn.ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  if (conn.ws.readyState === WebSocket.CLOSED) {
    return Promise.reject(new Error("Sync server is not connected."));
  }

  return conn.openPromise;
}

async function ensureConnection(tab) {
  if (!tab || !tab.id || !isSupportedTabUrl(tab.url)) {
    throw new Error("Only http and https pages can be synchronized.");
  }

  const tabId = tab.id;
  const pageKey = normalizePageKey(tab.url);
  const existing = connections.get(tabId);

  if (
    existing &&
    existing.pageKey === pageKey &&
    existing.ws &&
    existing.ws.readyState !== WebSocket.CLOSED
  ) {
    return existing;
  }

  if (existing && existing.ws) {
    existing.ws.close();
  }

  const userId = await getUserId();
  const clientId = createId(`client-${tabId}`);
  const ws = new WebSocket(WS_URL);

  let resolveOpen;
  let rejectOpen;
  const openPromise = new Promise((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });
  openPromise.catch(() => {});

  const conn = {
    tabId,
    pageKey,
    clientId,
    userId,
    ws,
    openPromise,
    sessionId: null,
    connectedClientId: null,
    status: "connecting",
    lastError: ""
  };

  connections.set(tabId, conn);

  ws.addEventListener("open", () => {
    conn.status = "ready";
    conn.lastError = "";
    ws.send(JSON.stringify({
      type: "join",
      clientId,
      userId,
      pageKey
    }));
    resolveOpen();
  });

  ws.addEventListener("message", (event) => {
    handleServerMessage(conn, event.data);
  });

  ws.addEventListener("close", () => {
    rejectOpen(new Error("Sync server connection was closed."));

    if (connections.get(tabId) === conn) {
      conn.status = "closed";
      conn.sessionId = null;
      conn.connectedClientId = null;
      notifyTab(tabId, {
        command: "screenmax-status",
        status: "closed"
      });
    }
  });

  ws.addEventListener("error", () => {
    conn.status = "error";
    conn.lastError = `Cannot connect to ${WS_URL}`;
    rejectOpen(new Error(conn.lastError));
  });

  return conn;
}

function sendToServer(conn, message) {
  if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
    throw new Error("Sync server is not connected.");
  }

  conn.ws.send(JSON.stringify(message));
}

function notifyTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

function handleServerMessage(conn, raw) {
  let msg;

  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.fromClientId === conn.clientId) return;

  if (msg.type === "assist-request") {
    if (msg.pageKey !== conn.pageKey) return;

    notifyTab(conn.tabId, {
      command: "screenmax-assist-request",
      request: msg
    });
    return;
  }

  if (msg.type === "assist-response") {
    if (msg.toClientId !== conn.clientId) return;

    if (msg.accepted) {
      conn.sessionId = msg.sessionId;
      conn.connectedClientId = msg.fromClientId;
      conn.status = "connected";
    } else {
      conn.status = "ready";
      conn.lastError = msg.reason || "The assistance request was rejected.";
    }

    notifyTab(conn.tabId, {
      command: "screenmax-assist-response",
      response: msg
    });
    return;
  }

  if (
    conn.sessionId &&
    msg.sessionId === conn.sessionId &&
    (
      msg.type === "mouse-event" ||
      msg.type === "wheel-event" ||
      msg.type === "scroll-event"
    )
  ) {
    notifyTab(conn.tabId, {
      command: "screenmax-replay-event",
      event: msg
    });
  }
}

async function requestAssistance(tab) {
  const conn = await ensureConnection(tab);
  const requestId = createId("req");

  await waitForOpen(conn);

  sendToServer(conn, {
    type: "assist-request",
    requestId,
    fromClientId: conn.clientId,
    fromUserId: conn.userId,
    pageKey: conn.pageKey
  });

  conn.status = "requesting";

  return {
    ok: true,
    status: conn.status,
    pageKey: conn.pageKey
  };
}

async function acceptAssistance(tabId, request) {
  const tab = await chrome.tabs.get(tabId);
  const conn = await ensureConnection(tab);
  const sessionId = createId("session");

  conn.sessionId = sessionId;
  conn.connectedClientId = request.fromClientId;
  conn.status = "connected";

  await waitForOpen(conn);

  sendToServer(conn, {
    type: "assist-response",
    requestId: request.requestId,
    toClientId: request.fromClientId,
    fromClientId: conn.clientId,
    fromUserId: conn.userId,
    accepted: true,
    sessionId
  });

  return { ok: true, status: conn.status };
}

async function rejectAssistance(tabId, request) {
  const tab = await chrome.tabs.get(tabId);
  const conn = await ensureConnection(tab);

  await waitForOpen(conn);

  sendToServer(conn, {
    type: "assist-response",
    requestId: request.requestId,
    toClientId: request.fromClientId,
    fromClientId: conn.clientId,
    fromUserId: conn.userId,
    accepted: false,
    reason: "The other user rejected the assistance request."
  });

  return { ok: true, status: conn.status };
}

async function forwardCapturedEvent(sender, payload) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return { ok: false };

  const tab = await chrome.tabs.get(tabId);
  const conn = await ensureConnection(tab);

  if (!conn.sessionId) {
    return { ok: false, reason: "No active session." };
  }

  await waitForOpen(conn);

  sendToServer(conn, {
    ...payload,
    clientId: conn.clientId,
    userId: conn.userId,
    sessionId: conn.sessionId,
    fromClientId: conn.clientId,
    frame: {
      frameId: sender.frameId,
      url: sender.url || ""
    }
  });

  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.command === "screenmax-popup-status") {
      const tab = await getActiveTab();
      if (!tab || !isSupportedTabUrl(tab.url)) {
        return { ok: false, status: "unsupported" };
      }

      const conn = await ensureConnection(tab);
      return {
        ok: true,
        status: conn.status,
        pageKey: conn.pageKey,
        sessionId: conn.sessionId,
        lastError: conn.lastError
      };
    }

    if (message.command === "screenmax-request-assist") {
      const tab = await getActiveTab();
      return requestAssistance(tab);
    }

    if (message.command === "screenmax-accept-assist") {
      return acceptAssistance(sender.tab.id, message.request);
    }

    if (message.command === "screenmax-reject-assist") {
      return rejectAssistance(sender.tab.id, message.request);
    }

    if (message.command === "screenmax-captured-event") {
      return forwardCapturedEvent(sender, message.payload);
    }

    return { ok: false, reason: "Unknown command." };
  })()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, reason: error.message });
    });

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const conn = connections.get(tabId);
  if (conn && conn.ws) {
    conn.ws.close();
  }
  connections.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;

  const conn = connections.get(tabId);
  if (!conn) return;

  const pageKey = normalizePageKey(tab.url);
  if (conn.pageKey !== pageKey) {
    conn.ws.close();
    connections.delete(tabId);
  }
});
