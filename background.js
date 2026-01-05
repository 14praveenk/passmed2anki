(() => {
  const extensionApi = typeof browser !== "undefined" ? browser : chrome;
  const ANKI_CONNECT_ENDPOINT = "http://127.0.0.1:8765";

  extensionApi.runtime.onInstalled.addListener((details) => {
    if (details?.reason !== "install") {
      return;
    }

    try {
      extensionApi.storage?.sync?.set?.({ passmed2anki_firstRun: true });
    } catch {
      // ignore
    }

    // Prefer opening options without requiring extra permissions.
    try {
      extensionApi.runtime.openOptionsPage?.();
    } catch {
      // ignore
    }
  });

  const asPromise = (maybePromise) => {
    if (maybePromise && typeof maybePromise.then === "function") {
      return maybePromise;
    }
    return Promise.resolve(maybePromise);
  };

  const handleMessage = async (message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type !== "PASSMED2ANKI_ANKICONNECT") {
      return;
    }

    const payload = message.payload;
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Missing payload" };
    }

    try {
      const resp = await fetch(ANKI_CONNECT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const json = await resp.json();
      if (json?.error) {
        return { ok: false, error: json.error };
      }

      return { ok: true, result: json?.result };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  };

  // Chrome uses callback-based messaging; Firefox also supports promises.
  extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const resultPromise = handleMessage(message, sender);

    // If this is not our message, do nothing.
    if (!resultPromise) {
      return;
    }

    asPromise(resultPromise)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));

    // Keep the message channel open for async response.
    return true;
  });
})();
