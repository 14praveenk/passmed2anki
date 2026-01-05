(() => {
  const extensionApi = typeof browser !== "undefined" ? browser : chrome;
  const DEFAULT_SETTINGS = {
    deckName: "Passmedicine",
    noteType: "Basic",
    tags: "passmedicine,passmed2anki"
  };

  const form = document.getElementById("settings-form");
  const deckInput = document.getElementById("deckName");
  const noteTypeInput = document.getElementById("noteType");
  const tagsInput = document.getElementById("tags");
  const statusEl = document.getElementById("status");
  const firstRunEl = document.getElementById("first-run");

  const FIRST_RUN_KEY = "passmed2anki_firstRun";

  const storageGet = () => {
    return new Promise((resolve) => {
      const storage = extensionApi?.storage?.sync;
      if (!storage) {
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }
      storage.get({ ...DEFAULT_SETTINGS, [FIRST_RUN_KEY]: false }, (items) => {
        resolve({ ...DEFAULT_SETTINGS, ...(items || {}) });
      });
    });
  };

  const storageSet = (payload) => {
    return new Promise((resolve, reject) => {
      const storage = extensionApi?.storage?.sync;
      if (!storage) {
        reject(new Error("Storage is not available"));
        return;
      }
      storage.set(payload, () => {
        if (extensionApi.runtime?.lastError) {
          reject(extensionApi.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  };

  const restore = async () => {
    const settings = await storageGet();
    deckInput.value = settings.deckName;
    noteTypeInput.value = settings.noteType;
    tagsInput.value = settings.tags;

    if (firstRunEl && settings[FIRST_RUN_KEY]) {
      firstRunEl.hidden = false;
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    statusEl.textContent = "Saving…";

    try {
      await storageSet({
        deckName: deckInput.value.trim(),
        noteType: noteTypeInput.value.trim(),
        tags: tagsInput.value.trim(),
        [FIRST_RUN_KEY]: false
      });
      statusEl.textContent = "Saved";

      if (firstRunEl) {
        firstRunEl.hidden = true;
      }

      setTimeout(() => (statusEl.textContent = ""), 2000);
    } catch (error) {
      statusEl.textContent = error.message || "Could not save";
    }
  };

  form.addEventListener("submit", handleSubmit);

  restore();
})();
