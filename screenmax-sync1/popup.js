const statusEl = document.getElementById("status");
const requestBtn = document.getElementById("requestBtn");

function setStatus(text) {
  statusEl.textContent = text;
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function refreshStatus() {
  const result = await sendMessage({ command: "screenmax-popup-status" });

  if (!result.ok) {
    requestBtn.disabled = true;
    setStatus(result.reason || "This page cannot be synchronized.");
    return;
  }

  requestBtn.disabled = false;
  setStatus(`Status: ${result.status}\nURL: ${result.pageKey}`);
}

requestBtn.addEventListener("click", async () => {
  requestBtn.disabled = true;
  setStatus("Sending assistance request...");

  const result = await sendMessage({ command: "screenmax-request-assist" });

  if (result.ok) {
    setStatus("Request sent. Waiting for the other browser to accept.");
  } else {
    setStatus(result.reason || "Failed to send request.");
  }

  requestBtn.disabled = false;
});

refreshStatus().catch((error) => {
  requestBtn.disabled = true;
  setStatus(error.message);
});
