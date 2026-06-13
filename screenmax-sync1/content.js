(function () {
  if (window.__screenmaxSyncLoaded) return;
  window.__screenmaxSyncLoaded = true;

  const SOURCE = "screenmax-sync-extension";
  const mouseEvents = [
    "mousemove",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "contextmenu"
  ];

  let isReplaying = false;
  let lastHoverEl = null;
  let pendingRequest = null;
  let remoteCursor = null;

  function isTopFrame() {
    return window.top === window;
  }

  function sendRuntimeMessage(message) {
    try {
      chrome.runtime.sendMessage(message, () => {
        chrome.runtime.lastError;
      });
    } catch {
      // The extension context can disappear during reloads.
    }
  }

  function captureMouseEvent(event) {
    if (isReplaying) return;

    sendRuntimeMessage({
      command: "screenmax-captured-event",
      payload: {
        type: "mouse-event",
        source: SOURCE,
        payload: {
          eventType: event.type,
          clientX: event.clientX,
          clientY: event.clientY,
          pageX: event.pageX,
          pageY: event.pageY,
          button: event.button,
          buttons: event.buttons,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          timestamp: Date.now()
        }
      }
    });
  }

  function captureWheelEvent(event) {
    if (isReplaying) return;

    sendRuntimeMessage({
      command: "screenmax-captured-event",
      payload: {
        type: "wheel-event",
        source: SOURCE,
        payload: {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          clientX: event.clientX,
          clientY: event.clientY,
          timestamp: Date.now()
        }
      }
    });
  }

  function captureScrollEvent() {
    if (isReplaying) return;

    sendRuntimeMessage({
      command: "screenmax-captured-event",
      payload: {
        type: "scroll-event",
        source: SOURCE,
        payload: {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          timestamp: Date.now()
        }
      }
    });
  }

  function createRemoteCursor() {
    if (remoteCursor) return remoteCursor;

    const cursor = document.createElement("div");
    cursor.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "z-index:2147483647",
      "pointer-events:none",
      "display:none",
      "font:12px Arial,sans-serif"
    ].join(";");

    cursor.innerHTML = `
      <div style="width:10px;height:10px;background:#ff4d4f;border-radius:50%;"></div>
      <div style="margin-left:12px;margin-top:-8px;background:#ff4d4f;color:#fff;padding:2px 6px;border-radius:4px;white-space:nowrap;">Remote</div>
    `;

    document.documentElement.appendChild(cursor);
    remoteCursor = cursor;
    return cursor;
  }

  function updateRemoteCursor(payload) {
    const cursor = createRemoteCursor();
    cursor.style.display = "block";
    cursor.style.left = `${payload.clientX}px`;
    cursor.style.top = `${payload.clientY}px`;
  }

  function updateRemoteHover(payload) {
    const target = document.elementFromPoint(payload.clientX, payload.clientY);

    if (lastHoverEl && lastHoverEl !== target) {
      lastHoverEl.removeAttribute("data-screenmax-remote-hover");
    }

    if (target) {
      target.setAttribute("data-screenmax-remote-hover", "true");
      lastHoverEl = target;
    }
  }

  function shouldReplayInThisFrame(event) {
    const frameUrl = event.frame && event.frame.url;
    return !frameUrl || frameUrl === location.href;
  }

  function replayMouseEvent(event) {
    if (!shouldReplayInThisFrame(event)) return;

    const payload = event.payload;
    updateRemoteCursor(payload);

    if (payload.eventType === "mousemove") {
      updateRemoteHover(payload);
    }

    const target = document.elementFromPoint(payload.clientX, payload.clientY);
    if (!target) return;

    isReplaying = true;

    const replayed = new MouseEvent(payload.eventType, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: payload.clientX,
      clientY: payload.clientY,
      button: payload.button,
      buttons: payload.buttons,
      altKey: payload.altKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      metaKey: payload.metaKey
    });

    target.dispatchEvent(replayed);
    isReplaying = false;
  }

  function replayWheelEvent(event) {
    if (!shouldReplayInThisFrame(event)) return;

    const payload = event.payload;
    isReplaying = true;

    window.scrollTo({
      left: payload.scrollX,
      top: payload.scrollY,
      behavior: "auto"
    });

    const target = document.elementFromPoint(payload.clientX, payload.clientY);
    if (target) {
      const replayed = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        view: window,
        deltaX: payload.deltaX,
        deltaY: payload.deltaY,
        deltaMode: payload.deltaMode,
        clientX: payload.clientX,
        clientY: payload.clientY
      });

      target.dispatchEvent(replayed);
    }

    isReplaying = false;
  }

  function replayScrollEvent(event) {
    if (!shouldReplayInThisFrame(event)) return;

    const payload = event.payload;
    isReplaying = true;
    window.scrollTo({
      left: payload.scrollX,
      top: payload.scrollY,
      behavior: "auto"
    });
    isReplaying = false;
  }

  function showStatus(text) {
    if (!isTopFrame()) return;

    const toast = document.createElement("div");
    toast.textContent = text;
    toast.style.cssText = [
      "position:fixed",
      "right:20px",
      "top:20px",
      "z-index:2147483647",
      "background:#1677ff",
      "color:#fff",
      "padding:10px 14px",
      "border-radius:6px",
      "font:14px Arial,sans-serif",
      "box-shadow:0 8px 24px rgba(0,0,0,.18)"
    ].join(";");

    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  function showAssistDialog(request) {
    if (!isTopFrame()) return;

    pendingRequest = request;

    const existing = document.getElementById("screenmax-sync-dialog");
    if (existing) existing.remove();

    const mask = document.createElement("div");
    mask.id = "screenmax-sync-dialog";
    mask.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "background:rgba(0,0,0,.45)",
      "font:14px Arial,sans-serif"
    ].join(";");

    const modal = document.createElement("div");
    modal.style.cssText = [
      "width:360px",
      "background:#fff",
      "color:#222",
      "border-radius:8px",
      "padding:22px",
      "box-shadow:0 12px 32px rgba(0,0,0,.24)"
    ].join(";");

    modal.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:18px;">ScreenMax assistance request</h3>
      <p style="margin:0 0 20px;line-height:1.5;">User ${escapeHtml(request.fromUserId)} wants to synchronize mouse operations with this page.</p>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button data-screenmax-action="reject" style="padding:8px 14px;border:1px solid #d9d9d9;background:#fff;border-radius:6px;cursor:pointer;">Reject</button>
        <button data-screenmax-action="accept" style="padding:8px 14px;border:1px solid #1677ff;background:#1677ff;color:#fff;border-radius:6px;cursor:pointer;">Accept</button>
      </div>
    `;

    modal.addEventListener("click", (event) => {
      const action = event.target && event.target.getAttribute("data-screenmax-action");
      if (!action || !pendingRequest) return;

      sendRuntimeMessage({
        command: action === "accept" ? "screenmax-accept-assist" : "screenmax-reject-assist",
        request: pendingRequest
      });

      pendingRequest = null;
      mask.remove();
    });

    mask.appendChild(modal);
    document.documentElement.appendChild(mask);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.command === "screenmax-assist-request") {
      showAssistDialog(message.request);
      return;
    }

    if (message.command === "screenmax-assist-response") {
      showStatus(message.response.accepted ? "ScreenMax connected" : "ScreenMax request rejected");
      return;
    }

    if (message.command === "screenmax-status") {
      showStatus(`ScreenMax ${message.status}`);
      return;
    }

    if (message.command !== "screenmax-replay-event") return;

    if (message.event.type === "mouse-event") {
      replayMouseEvent(message.event);
    }

    if (message.event.type === "wheel-event") {
      replayWheelEvent(message.event);
    }

    if (message.event.type === "scroll-event") {
      replayScrollEvent(message.event);
    }
  });

  mouseEvents.forEach((eventName) => {
    document.addEventListener(eventName, captureMouseEvent, true);
  });

  window.addEventListener("wheel", captureWheelEvent, {
    capture: true,
    passive: true
  });
  window.addEventListener("scroll", captureScrollEvent, true);
})();
