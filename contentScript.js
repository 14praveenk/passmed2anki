(() => {
  const extensionApi = typeof browser !== "undefined" ? browser : chrome;

  const DEFAULT_SETTINGS = {
    deckName: "Passmedicine",
    noteType: "Basic",
    tags: "passmedicine,passmed2anki"
  };

  const SELECTORS = {
    question: [
      "#question_only",
      "#div_question #question_only",
      "#div_question",
      "[data-component='question-body']",
      ".question-stem",
      ".question-text",
      "#question-body",
      ".questionBody",
      ".question",
      "main article",
      "[class*='question'] [class*='body']",
      "[data-cy='question-text']",
      "article [class*='prompt']"
    ],
    answer: [
      "#div_question .alert.alert-success",
      "#div_question .alert-success",
      ".alert.alert-success",
      "#div_question .alert.alert-danger",
      "#div_question .alert-danger",
      ".alert.alert-danger",
      "[data-component='answer']",
      ".answer-reveal",
      "#answer",
      ".answer",
      ".explanation",
      ".rationale",
      ".answer-panel",
      "[class*='explanation']",
      "[data-cy='answer']",
      "details[open] .accordion-body"
    ],
    options: [
      "#div_question .list-group",
      "#div_question .list-group-item",
      ".list-group",
      "[data-component='answer-options']",
      ".answers-list",
      ".answer-options",
      ".option-list",
      ".options",
      "ul",
      "ol",
      "[data-cy='answer-options']",
      "[class*='choices']"
    ]
  };

  const HEURISTICS = {
    answerKeywords: [
      "explanation",
      "rationale",
      "correct answer",
      "incorrect",
      "correct",
      "your answer",
      "answer"
    ],
    questionKeywords: ["question"],
    minAnswerChars: 60,
    maxAnswerChars: 60000,
    minQuestionChars: 30,
    maxQuestionChars: 20000
  };

  const STATE = {
    button: null,
    toast: null,
    settings: { ...DEFAULT_SETTINGS },
    mutationObserver: null,
    lastQuestionSignature: "",
    evaluationTimeout: null,
    debug: false
  };

  const ANKI_CONNECT_ENDPOINT = "http://127.0.0.1:8765";

  const init = async () => {
    await loadSettings();
    installDebugBridge();
    observeDom();
    evaluateInjection();
  };

  const installDebugBridge = () => {
    window.addEventListener(
      "message",
      (event) => {
        if (event.source !== window) {
          return;
        }
        const data = event.data;
        if (!data || typeof data !== "object") {
          return;
        }
        if (!data.__passmed2anki) {
          return;
        }

        const debugValue = data.__passmed2anki.debug;
        if (typeof debugValue === "boolean") {
          STATE.debug = debugValue;
          logDebug(`Debug mode ${STATE.debug ? "enabled" : "disabled"}`);
          scheduleEvaluation();
        }
      },
      false
    );
  };

  const loadSettings = () => {
    return new Promise((resolve) => {
      const storage = extensionApi?.storage?.sync;
      if (!storage) {
        resolve();
        return;
      }

      storage.get(DEFAULT_SETTINGS, (items) => {
        STATE.settings = normalizeSettings(items || {});
        resolve();
      });
    });
  };

  const normalizeSettings = (raw) => {
    return {
      deckName: raw.deckName?.trim() || DEFAULT_SETTINGS.deckName,
      noteType: raw.noteType?.trim() || DEFAULT_SETTINGS.noteType,
      tags: raw.tags?.trim() || DEFAULT_SETTINGS.tags
    };
  };

  const observeDom = () => {
    if (STATE.mutationObserver || !document.body) {
      return;
    }

    STATE.mutationObserver = new MutationObserver(scheduleEvaluation);
    STATE.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"]
    });

    window.addEventListener("hashchange", scheduleEvaluation, { passive: true });
    window.addEventListener("popstate", scheduleEvaluation, { passive: true });
  };

  const scheduleEvaluation = () => {
    clearTimeout(STATE.evaluationTimeout);
    STATE.evaluationTimeout = setTimeout(evaluateInjection, 250);
  };

  const evaluateInjection = () => {
    const questionEl = findVisibleElement(SELECTORS.question) || heuristicFindPanel({
      keywords: HEURISTICS.questionKeywords,
      minChars: HEURISTICS.minQuestionChars,
      maxChars: HEURISTICS.maxQuestionChars,
      root: document.body
    });

    // Only show the button once the user has chosen an answer and the
    // correct/incorrect alerts are displayed.
    const chosenState = getChosenAnswerState();
    const answerEl = chosenState.alertEl;

    const questionText = extractText(questionEl);
    const answerText = extractText(answerEl);

    if (!chosenState.isChosen || !answerEl || !answerText) {
      logDebug("Answer not chosen yet", {
        isChosen: chosenState.isChosen,
        hasAlertEl: Boolean(answerEl),
        hasResultStyledOption: chosenState.hasResultStyledOption
      });
      removeButton();
      return;
    }

    if (!questionText) {
      logDebug("No question text detected", { questionText });
      removeButton();
      return;
    }

    const signature = `${questionText.slice(0, 120)}::${answerText.slice(0, 120)}`;
    if (STATE.lastQuestionSignature !== signature) {
      STATE.lastQuestionSignature = signature;
      removeButton();
    }

    if (STATE.button) {
      return;
    }

    STATE.button = createButton();
    const anchor = answerEl || questionEl;
    if (anchor?.parentElement) {
      anchor.parentElement.insertBefore(STATE.button, anchor);
    } else {
      document.body.appendChild(STATE.button);
    }
  };

  const getChosenAnswerState = () => {
    // Passmedicine shows a green (success) or red (danger) alert after submission.
    // We deliberately *do not* fall back to heuristics here, to avoid showing the
    // button before an answer is chosen.
    const alertEl =
      findVisibleElement(["#div_question .alert.alert-success", ".alert.alert-success"]) ||
      findVisibleElement(["#div_question .alert.alert-danger", ".alert.alert-danger"]);

    // Passmedicine often styles options with green/red bars when answered.
    const root = document.querySelector("#div_question") || document.body;
    const optionNodes = Array.from(root.querySelectorAll("a.list-group-item, label.list-group-item"));
    const hasResultStyledOption = optionNodes.some((a) => {
      const styleAttr = (a.getAttribute("style") || "").toLowerCase();
      return (
        styleAttr.includes("greenbar.png") ||
        styleAttr.includes("redbar.png") ||
        styleAttr.includes("solid green") ||
        styleAttr.includes("solid red") ||
        // Post-submit option blocks also include border-left styling.
        styleAttr.includes("border-left") ||
        a.classList.contains("bg-success") ||
        a.classList.contains("bg-danger") ||
        a.classList.contains("list-group-item-success") ||
        a.classList.contains("list-group-item-danger")
      );
    });

    const hasPopularityBadges =
      root.querySelector("[id^='popularity_badge']") !== null ||
      root.querySelector(".score-badge") !== null;

    const submitButtonVisible = isVisible(document.querySelector("#submit_answer"));

    // Only show once an answer has been submitted: require the alert plus either
    // result-style indicators (green/red bars or popularity badges) or the submit
    // button disappearing.
    const isChosen =
      Boolean(alertEl) &&
      (hasResultStyledOption || hasPopularityBadges || !submitButtonVisible);

    return { isChosen, alertEl, hasResultStyledOption, hasPopularityBadges, submitButtonVisible };
  };

  const removeButton = () => {
    if (!STATE.button) {
      return;
    }
    STATE.button.remove();
    STATE.button = null;
  };

  const findVisibleElement = (selectors) => {
    for (const selector of selectors) {
      const candidates = selector ? Array.from(document.querySelectorAll(selector)) : [];
      for (const el of candidates) {
        if (isVisible(el)) {
          return el;
        }
      }
    }
    return null;
  };

  const isVisible = (el) => {
    if (!el) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    if (el.closest("[hidden]")) {
      return false;
    }
    return el.getClientRects().length > 0;
  };

  const extractText = (el) => {
    if (!el) {
      return "";
    }
    return el.innerText
      .trim()
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  };

  const normalizeHtml = (html) => {
    return String(html || "").trim();
  };

  const extractCleanHtml = (el, { removeSelectors = [] } = {}) => {
    if (!el) {
      return "";
    }

    const clone = el.cloneNode(true);
    for (const selector of removeSelectors) {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
    }

    return normalizeHtml(clone.innerHTML);
  };

  const extractAlertSuccessInfoOnlyHtml = () => {
    const alertEl =
      findVisibleElement(["#div_question .alert.alert-success", ".alert.alert-success"]) ||
      findVisibleElement(["#div_question .alert.alert-danger", ".alert.alert-danger"]) ||
      findVisibleElement(["#div_question .alert[role='alert']", ".alert[role='alert']"]);
    if (!alertEl) {
      return "";
    }

    return extractCleanHtml(alertEl, {
      removeSelectors: [
        "#question_concept_rating_div",
        "#question_concept_percentile_div",
        ".rate_question_concept"
      ]
    });
  };

  const heuristicFindPanel = ({ keywords, minChars, maxChars, root }) => {
    if (!root) {
      return null;
    }

    const kw = (keywords || []).map((k) => String(k).toLowerCase());
    const all = Array.from(root.querySelectorAll("section, article, main, aside, details, div"));

    const candidates = [];
    for (const el of all) {
      if (!isVisible(el)) {
        continue;
      }
      const text = extractText(el);
      if (!text) {
        continue;
      }
      if (text.length < minChars || text.length > maxChars) {
        continue;
      }
      const lower = text.toLowerCase();
      if (kw.length && !kw.some((k) => lower.includes(k))) {
        continue;
      }
      candidates.push({ el, score: scoreCandidate(el, text) });
    }

    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0]?.el || null;
    logDebug("Heuristic panel result", {
      found: Boolean(winner),
      candidates: candidates.length,
      topScore: candidates[0]?.score
    });
    return winner;
  };

  const scoreCandidate = (el, text) => {
    const depth = getDomDepth(el);
    // Prefer deeper (more specific) nodes but avoid tiny/huge blobs.
    const lengthPenalty = Math.abs(800 - Math.min(text.length, 2000)) / 800;
    return depth * 2 - lengthPenalty;
  };

  const getDomDepth = (el) => {
    let depth = 0;
    let cur = el;
    while (cur && cur.parentElement) {
      depth += 1;
      cur = cur.parentElement;
      if (depth > 80) {
        break;
      }
    }
    return depth;
  };

  const extractOptionsText = () => {
    const container = findVisibleElement(SELECTORS.options);
    if (!container) {
      return "";
    }
    const options = Array.from(
      container.querySelectorAll(
        "a.list-group-item, li, [role='option'], .answer-option, .option, label, a"
      )
    )
      .map((node) => extractText(node))
      .filter(Boolean);

    return Array.from(new Set(options)).join("\n");
  };

  const createButton = () => {
    const btn = document.createElement("button");
    btn.id = "pm-anki-button";
    btn.type = "button";
    btn.textContent = "Add to Anki";
    btn.addEventListener("click", handleAddToAnki);
    return btn;
  };

  const handleAddToAnki = async (event) => {
    event.preventDefault();
    const button = event.currentTarget;
    button.disabled = true;
    showToast("Sending to Anki…");

    try {
      const payload = buildNotePayload();
      if (!payload) {
        throw new Error("Missing question or answer text");
      }

      const result = await sendToBackground(payload);
      if (!result?.ok) {
        throw new Error(result?.error || "AnkiConnect request failed");
      }
      showToast("Saved to Anki");
    } catch (error) {
      console.error("Passmed2Anki", error);
      showToast(error.message || "Could not reach AnkiConnect", true);
    } finally {
      button.disabled = false;
    }
  };

  const sendToBackground = (payload) => {
    return new Promise((resolve, reject) => {
      try {
        if (!extensionApi?.runtime?.sendMessage) {
          reject(new Error("Extension messaging unavailable"));
          return;
        }

        extensionApi.runtime.sendMessage(
          { type: "PASSMED2ANKI_ANKICONNECT", payload },
          (response) => {
            const lastError = extensionApi.runtime?.lastError;
            if (lastError) {
              reject(new Error(lastError.message || String(lastError)));
              return;
            }
            resolve(response);
          }
        );
      } catch (err) {
        reject(err);
      }
    });
  };

  const buildNotePayload = () => {
    // Spec requirements:
    // - Front: ONLY #question_only
    // - Back: "green" option text + blank line + .alert.alert-success text
    const questionEl = document.querySelector("#question_only");
    const questionHtml = normalizeHtml(questionEl?.innerHTML);
    const explanationHtml = extractAlertSuccessInfoOnlyHtml();
    const correctHtml = extractGreenOptionHtml();

    if (!questionHtml || !explanationHtml) {
      logDebug("Missing fields for Anki payload", {
        hasQuestion: Boolean(questionHtml),
        hasExplanation: Boolean(explanationHtml)
      });
      return null;
    }

    // Back: green option + blank line + explanation (keep Passmedicine HTML)
    const backHtml = [correctHtml, explanationHtml].filter(Boolean).join("<br><br>");
    const tags = normalizeTags(STATE.settings.tags);

    return {
      action: "addNote",
      version: 6,
      params: {
        note: {
          deckName: STATE.settings.deckName,
          modelName: STATE.settings.noteType,
          fields: {
            Front: questionHtml,
            Back: backHtml
          },
          tags: Array.from(new Set([...tags, "passmedicine"])) ,
          options: {
            allowDuplicate: false
          }
        }
      }
    };
  };

  const extractGreenOptionHtml = () => {
    const root = document.querySelector("#div_question") || document.body;
    const options = Array.from(root.querySelectorAll("a.list-group-item"));
    if (!options.length) {
      return "";
    }

    const greenCandidates = options.filter((a) => {
      const styleAttr = (a.getAttribute("style") || "").toLowerCase();
      if (styleAttr.includes("greenbar.png")) {
        return true;
      }
      if (styleAttr.includes("solid green")) {
        return true;
      }
      // Some layouts may apply a bootstrap success class.
      if (a.classList.contains("bg-success") || a.classList.contains("list-group-item-success")) {
        return true;
      }
      return false;
    });

    const best = greenCandidates[0] || null;
    if (!best) {
      return "";
    }

    // Prefer the first <span> which is the option label; ignore the % badge.
    const labelSpan = best.querySelector("span");
    const labelHtml = normalizeHtml((labelSpan || best).innerHTML);
    return labelHtml;
  };

  const normalizeTags = (tagString) => {
    return tagString
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  };

  const showToast = (message, isError = false) => {
    if (!STATE.toast) {
      STATE.toast = document.createElement("div");
      STATE.toast.id = "pm-anki-toast";
      document.body.appendChild(STATE.toast);
    }
    STATE.toast.textContent = message;
    STATE.toast.dataset.state = isError ? "error" : "success";
    STATE.toast.classList.add("visible");
    clearTimeout(STATE.toast._timer);
    STATE.toast._timer = setTimeout(() => {
      STATE.toast?.classList.remove("visible");
    }, 3000);
  };

  const logDebug = (message, payload = {}) => {
    if (!STATE.debug) {
      return;
    }
    console.debug(`[Passmed2Anki] ${message}`, payload);
  };

  // Note: MV3 content scripts are isolated from the page context, so this
  // function is not callable from the normal page console in Chromium.
  // Use the postMessage bridge instead (documented in README).
  window.passmed2ankiDebug = (enable = true) => {
    STATE.debug = Boolean(enable);
    logDebug(`Debug mode ${STATE.debug ? "enabled" : "disabled"}`);
    scheduleEvaluation();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
