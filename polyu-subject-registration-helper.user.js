// ==UserScript==
// @name         PolyU eStudent Subject Registration Helper
// @namespace    https://www.polyu.edu.hk/
// @version      0.1.0
// @description  Apply an explicit drop/add plan and stop before the final confirmation.
// @author       You
// @match        https://www38.polyu.edu.hk/eStudent/secure/my-subject-registration/*subject-register-select-subject.jsf
// @match        https://www38.polyu.edu.hk/eStudent/secure/my-subject-registration/*subject-register-select-component.jsf
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_ID = "polyu-registration-helper";
  const PLAN_STORAGE_KEY = "polyu-registration-helper-plan-v1";
  const STATE_STORAGE_KEY = "polyu-registration-helper-state-v1";
  const ACTION_TIMEOUT_MS = 30000;
  const DOM_SETTLE_MS = 500;

  const selectors = {
    searchInput: 'input[id$=":basicSearchSubjectCode"]',
    searchButton: 'input[id$=":basicSearchButton"]',
    resultGroupSelect:
      'select[id*="basicSearchTable"][id$="basicSearchSubjectGroup_"]',
    resultAddButton:
      'input[id*="basicSearchTable"][id$="basicSearchAddSubjectButton_"]',
    componentGroupSelect: 'select[id$=":selectCompSubjectGroup"]',
    componentCheckbox:
      'input[type="checkbox"][id*="ComponentTable"][id$="selectCompSelected_"]',
    addToCartButton: 'input[id$=":selectButton"]',
    cartDeleteButton: [
      'input[type="image"][id*="rubbishBinButton_"]',
      'input[type="image"][id*="RubbishBinButton_"]',
    ].join(","),
  };

  let panel;
  let dropInput;
  let addInput;
  let statusElement;
  let runButton;
  let cancelButton;
  let resetButton;
  let automationBusy = false;
  let panelRepairTimer;

  function normalizeCode(value) {
    return String(value || "")
      .trim()
      .toUpperCase();
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function textTokens(value) {
    return normalizeText(value)
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter(Boolean);
  }

  function rowContainsCode(row, code) {
    return textTokens(row?.innerText).includes(normalizeCode(code));
  }

  function parsePlan(dropText, addText) {
    const drop = dropText
      .split(/\r?\n/)
      .map(normalizeCode)
      .filter(Boolean);

    const add = addText
      .split(/\r?\n/)
      .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
      .filter(({ line }) => line && !line.startsWith("#"))
      .map(({ line, lineNumber }) => {
        const fields = line.split("|").map((field) => field.trim());
        const subject = normalizeCode(fields[0]);
        const group = normalizeCode(fields[1]);
        const components = (fields[2] || "")
          .split(",")
          .map(normalizeCode)
          .filter(Boolean);

        if (
          !subject ||
          !group ||
          components.length === 0 ||
          fields.length !== 3
        ) {
          throw new Error(
            `Invalid Add line ${lineNumber}. Use: SUBJECT | SUBJECT_GROUP | COMPONENT[, COMPONENT]`,
          );
        }

        return {
          subject,
          group,
          components: [...new Set(components)],
        };
      });

    if (drop.length === 0 && add.length === 0) {
      throw new Error("The plan is empty.");
    }

    const duplicateDrops = drop.filter(
      (subject, index) => drop.indexOf(subject) !== index,
    );
    const addSubjects = add.map(({ subject }) => subject);
    const duplicateAdds = addSubjects.filter(
      (subject, index) => addSubjects.indexOf(subject) !== index,
    );

    if (duplicateDrops.length > 0) {
      throw new Error(`Duplicate Drop subject: ${duplicateDrops[0]}`);
    }

    if (duplicateAdds.length > 0) {
      throw new Error(`Duplicate Add subject: ${duplicateAdds[0]}`);
    }

    return { drop, add };
  }

  function readStoredPlanText() {
    return GM_getValue(PLAN_STORAGE_KEY, { drop: "", add: "" });
  }

  function savePlanText() {
    const value = { drop: dropInput.value, add: addInput.value };
    GM_setValue(PLAN_STORAGE_KEY, value);
    return value;
  }

  function defaultState() {
    return {
      running: false,
      phase: "idle",
      dropIndex: 0,
      addIndex: 0,
      pendingDrop: null,
      plan: null,
      previewVerification: null,
      message: "Ready.",
      error: null,
    };
  }

  function readState() {
    return {
      ...defaultState(),
      ...GM_getValue(STATE_STORAGE_KEY, {}),
    };
  }

  function saveState(state) {
    GM_setValue(STATE_STORAGE_KEY, state);
    updateControls(state);
  }

  function isMockMode() {
    return location.pathname.includes("/mock-subject-register-");
  }

  function controlLabel(element) {
    if (!element) return "";
    return normalizeText(element.value || element.textContent);
  }

  function findButton(label) {
    return [...document.querySelectorAll('input[type="submit"], button')].find(
      (element) => controlLabel(element) === label,
    );
  }

  function getCartRows() {
    return [...document.querySelectorAll(selectors.cartDeleteButton)]
      .map((button) => ({ button, row: button.closest("tr") }))
      .filter(({ row }) => row);
  }

  function findCartRow(subject) {
    return getCartRows().find(({ row }) => rowContainsCode(row, subject));
  }

  function cartContainsAddition(addition) {
    const entry = findCartRow(addition.subject);
    if (!entry) return false;
    const tokens = textTokens(entry.row.innerText);
    return (
      tokens.includes(addition.group) &&
      addition.components.every((component) => tokens.includes(component))
    );
  }

  function findSearchResult(subject) {
    for (const groupSelect of document.querySelectorAll(
      selectors.resultGroupSelect,
    )) {
      const row = groupSelect.closest("tr");
      if (!row || !rowContainsCode(row, subject)) continue;
      const addButton = row.querySelector(selectors.resultAddButton);
      if (addButton) return { row, groupSelect, addButton };
    }
    return null;
  }

  function getComponentRows() {
    return [...document.querySelectorAll(selectors.componentCheckbox)]
      .map((checkbox) => {
        const row = checkbox.closest("tr");
        const firstCell = row?.cells?.[0];
        const code = normalizeCode(
          normalizeText(firstCell?.innerText).split(" ")[0],
        );
        return { checkbox, row, code };
      })
      .filter(({ row, code }) => row && code);
  }

  function findGroupOption(groupSelect, group) {
    const normalizedGroup = normalizeCode(group);
    return [...groupSelect.options].find((option) => {
      const label = normalizeText(option.textContent).toUpperCase();
      if (!label.startsWith(normalizedGroup)) return false;
      const suffix = label.slice(normalizedGroup.length).trimStart();
      return suffix === "" || suffix.startsWith("(");
    });
  }

  function isPreviewPage() {
    return Boolean(findButton("Confirm") && findButton("Modify"));
  }

  function verifyPreviewPlan(plan) {
    if (!plan || !Array.isArray(plan.drop) || !Array.isArray(plan.add)) {
      return {
        ok: false,
        errors: ["No execution plan is available for Preview verification."],
        entries: [],
      };
    }

    const validStatuses = new Set([
      "TO CHANGE GROUP/COMPONENT",
      "TO DROP",
      "TO ADD",
    ]);
    const entries = [...document.querySelectorAll("tr")].flatMap((row) => {
      const cells = [...row.cells];
      const status = normalizeText(cells[0]?.innerText).toUpperCase();
      if (cells.length < 6 || !validStatuses.has(status)) return [];
      return [
        {
          status,
          subject: normalizeCode(cells[2].innerText),
          group: normalizeCode(cells[4].innerText),
          components: textTokens(cells[5].innerText),
        },
      ];
    });

    const droppedSubjects = new Set(plan.drop);
    const additionsBySubject = new Map(
      plan.add.map((addition) => [addition.subject, addition]),
    );
    const expectedSubjects = new Set([
      ...droppedSubjects,
      ...additionsBySubject.keys(),
    ]);
    const errors = [];

    for (const subject of expectedSubjects) {
      const matchingEntries = entries.filter((entry) => entry.subject === subject);
      if (matchingEntries.length === 0) {
        errors.push(`${subject}: missing from Preview.`);
        continue;
      }
      if (matchingEntries.length > 1) {
        errors.push(`${subject}: appears ${matchingEntries.length} times in Preview.`);
        continue;
      }

      const entry = matchingEntries[0];
      const wasDropped = droppedSubjects.has(subject);
      const addition = additionsBySubject.get(subject);
      const expectedStatus =
        wasDropped && addition
          ? "TO CHANGE GROUP/COMPONENT"
          : wasDropped
            ? "TO DROP"
            : "TO ADD";

      if (entry.status !== expectedStatus) {
        errors.push(
          `${subject}: expected ${expectedStatus}, found ${entry.status}.`,
        );
      }

      if (addition) {
        if (entry.group !== addition.group) {
          errors.push(
            `${subject}: expected subject group ${addition.group}, found ${entry.group || "none"}.`,
          );
        }

        const expectedComponents = [...addition.components].sort();
        const actualComponents = [...new Set(entry.components)].sort();
        if (JSON.stringify(actualComponents) !== JSON.stringify(expectedComponents)) {
          errors.push(
            `${subject}: expected component(s) ${expectedComponents.join(", ")}, found ${actualComponents.join(", ") || "none"}.`,
          );
        }
      }
    }

    for (const entry of entries) {
      if (!expectedSubjects.has(entry.subject)) {
        errors.push(
          `${entry.subject}: unexpected Preview action ${entry.status}.`,
        );
      }
    }

    return { ok: errors.length === 0, errors, entries };
  }

  function setStatus(message, kind = "info") {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.dataset.kind = kind;
  }

  function updateControls(state = readState()) {
    if (!runButton || !cancelButton || !resetButton) return;
    runButton.disabled = state.running || isPreviewPage();
    cancelButton.disabled = !state.running;
    dropInput.disabled = state.running;
    addInput.disabled = state.running;
    setStatus(state.error || state.message || "Ready.", state.error ? "error" : "info");
  }

  function failAutomation(error) {
    const message = error instanceof Error ? error.message : String(error);
    const state = readState();
    state.running = false;
    state.phase = "error";
    state.error = message;
    state.message = "Automation stopped.";
    saveState(state);
    setStatus(message, "error");
  }

  function stopAtPreview() {
    const confirmButton = findButton("Confirm");
    const state = readState();
    const verification = verifyPreviewPlan(state.plan);
    state.running = false;
    state.previewVerification = verification;

    if (verification.ok) {
      state.phase = "awaiting-human-confirmation";
      state.error = null;
      state.message = `Preview verified: ${verification.entries.length} action(s) match the plan. Review the changes and click Confirm manually.`;
      if (confirmButton) {
        confirmButton.style.outline = "4px solid #f59e0b";
      }
    } else {
      state.phase = "preview-verification-failed";
      state.error = `Preview verification failed:\n- ${verification.errors.join("\n- ")}\nUse Modify to correct the plan. Confirm was not clicked.`;
      state.message = "Automation stopped because Preview did not match the plan.";
      if (confirmButton) {
        confirmButton.style.outline = "4px solid #dc2626";
      }
    }

    if (confirmButton) {
      confirmButton.style.outlineOffset = "3px";
      confirmButton.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    saveState(state);
  }

  function dispatchValueChange(element, value) {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function triggerAndWait(trigger, actionName) {
    return new Promise((resolve, reject) => {
      const root = document.documentElement;
      let sawRelevantMutation = false;
      let settleTimer;

      const cleanup = () => {
        observer.disconnect();
        clearTimeout(timeoutTimer);
        clearTimeout(settleTimer);
      };

      const finish = () => {
        cleanup();
        resolve();
      };

      const observer = new MutationObserver((records) => {
        const relevant = records.some(
          (record) => !panel || !panel.contains(record.target),
        );
        if (!relevant) return;
        sawRelevantMutation = true;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, DOM_SETTLE_MS);
      });

      observer.observe(root, { childList: true, subtree: true });

      const timeoutTimer = setTimeout(() => {
        cleanup();
        if (sawRelevantMutation) {
          resolve();
          return;
        }
        reject(new Error(`${actionName} did not update the page.`));
      }, ACTION_TIMEOUT_MS);

      trigger();
    });
  }

  function setProgress(state, message) {
    state.message = message;
    state.error = null;
    saveState(state);
    setStatus(message);
  }

  async function processDrops(state, plan) {
    if (state.dropIndex >= plan.drop.length) {
      state.phase = "add";
      state.pendingDrop = null;
      setProgress(state, "All requested subjects were dropped. Starting additions.");
      return true;
    }

    const subject = plan.drop[state.dropIndex];
    const cartEntry = findCartRow(subject);

    if (state.pendingDrop === subject) {
      if (cartEntry) {
        throw new Error(`Drop did not remove ${subject}. Check the page message.`);
      }
      state.dropIndex += 1;
      state.pendingDrop = null;
      setProgress(state, `Dropped ${subject}.`);
      return true;
    }

    if (!cartEntry) {
      throw new Error(`${subject} is not present in the subject cart and cannot be dropped.`);
    }

    state.pendingDrop = subject;
    setProgress(state, `Dropping ${subject}...`);
    await triggerAndWait(() => cartEntry.button.click(), `Drop ${subject}`);
    return true;
  }

  async function searchForAddition(state, addition) {
    if (cartContainsAddition(addition)) {
      state.addIndex += 1;
      state.phase = "add";
      setProgress(state, `Added ${addition.subject}.`);
      return true;
    }

    if (state.phase === "verify-add") {
      throw new Error(
        `${addition.subject} was not found in the cart after Add to Cart. Check the page message.`,
      );
    }

    const searchInput = document.querySelector(selectors.searchInput);
    const searchButton = document.querySelector(selectors.searchButton);
    if (!searchInput || !searchButton) {
      throw new Error("The Basic Search controls are not available.");
    }

    const result = findSearchResult(addition.subject);
    if (!result) {
      dispatchValueChange(searchInput, addition.subject);
      state.phase = "search";
      setProgress(state, `Searching for ${addition.subject}...`);
      await triggerAndWait(() => searchButton.click(), `Search ${addition.subject}`);
      return true;
    }

    const groupOption = findGroupOption(result.groupSelect, addition.group);
    if (!groupOption) {
      throw new Error(
        `${addition.subject} has no subject group starting with ${addition.group}.`,
      );
    }

    if (result.groupSelect.value !== groupOption.value) {
      state.phase = "search";
      setProgress(
        state,
        `Selecting ${addition.subject} group ${normalizeText(groupOption.textContent)}...`,
      );
      await triggerAndWait(
        () => dispatchValueChange(result.groupSelect, groupOption.value),
        `Select ${addition.subject} group ${addition.group}`,
      );
      return true;
    }

    state.phase = "select-components";
    setProgress(state, `Opening component choices for ${addition.subject}...`);
    await triggerAndWait(
      () => result.addButton.click(),
      `Open ${addition.subject} components`,
    );
    return true;
  }

  async function selectComponents(state, addition, groupSelect) {
    const groupOption = findGroupOption(groupSelect, addition.group);
    if (!groupOption) {
      throw new Error(
        `${addition.subject} has no subject group starting with ${addition.group}.`,
      );
    }

    if (groupSelect.value !== groupOption.value) {
      setProgress(
        state,
        `Selecting ${addition.subject} group ${normalizeText(groupOption.textContent)}...`,
      );
      await triggerAndWait(
        () => dispatchValueChange(groupSelect, groupOption.value),
        `Select group ${addition.group}`,
      );
      return true;
    }

    const componentRows = getComponentRows();
    const missing = addition.components.filter(
      (code) => !componentRows.some((row) => row.code === code),
    );
    if (missing.length > 0) {
      throw new Error(
        `Selected group no longer contains component(s): ${missing.join(", ")}.`,
      );
    }

    for (const { checkbox, code } of componentRows) {
      const shouldBeChecked = addition.components.includes(code);
      if (checkbox.checked === shouldBeChecked) continue;
      checkbox.checked = shouldBeChecked;
      checkbox.dispatchEvent(new Event("input", { bubbles: true }));
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const addToCartButton = document.querySelector(selectors.addToCartButton);
    if (!addToCartButton) {
      throw new Error("Add to Cart is not available.");
    }

    state.phase = "verify-add";
    setProgress(
      state,
      `Adding ${addition.subject} (${addition.components.join(", ")}) from group ${addition.group}...`,
    );
    await triggerAndWait(
      () => addToCartButton.click(),
      `Add ${addition.subject} to cart`,
    );
    return true;
  }

  async function processAdditions(state, plan) {
    if (state.addIndex >= plan.add.length) {
      state.phase = "proceed-to-preview";
      setProgress(state, "All additions are in the cart. Proceeding to Preview...");
      return true;
    }

    const addition = plan.add[state.addIndex];
    const groupSelect = document.querySelector(selectors.componentGroupSelect);

    if (groupSelect) {
      const subjectSummaryRow = groupSelect.closest("tr");
      if (!rowContainsCode(subjectSummaryRow, addition.subject)) {
        const backButton = findButton("Back");
        if (!backButton) {
          throw new Error(
            `The component page is not for ${addition.subject}, and Back is unavailable.`,
          );
        }
        state.phase = "add";
        setProgress(
          state,
          `Returning from a different component page before adding ${addition.subject}...`,
        );
        await triggerAndWait(
          () => backButton.click(),
          `Return to search for ${addition.subject}`,
        );
        return true;
      }

      if (state.phase !== "select-components") {
        state.phase = "select-components";
        saveState(state);
      }
      return selectComponents(state, addition, groupSelect);
    }

    return searchForAddition(state, addition);
  }

  async function proceedToPreview(state) {
    if (isPreviewPage()) {
      stopAtPreview();
      return false;
    }

    const previewButton = findButton("Proceed to Preview");
    if (!previewButton) {
      throw new Error("Proceed to Preview is not available.");
    }

    state.phase = "await-preview";
    setProgress(state, "Opening Preview. The script will not click Confirm.");
    await triggerAndWait(() => previewButton.click(), "Proceed to Preview");
    return true;
  }

  async function advanceAutomation(state, plan) {
    if (isPreviewPage()) {
      stopAtPreview();
      return false;
    }

    if (state.phase === "drop") {
      return processDrops(state, plan);
    }

    if (
      state.phase === "add" ||
      state.phase === "search" ||
      state.phase === "select-components" ||
      state.phase === "verify-add"
    ) {
      return processAdditions(state, plan);
    }

    if (state.phase === "proceed-to-preview" || state.phase === "await-preview") {
      return proceedToPreview(state);
    }

    throw new Error(`Unknown automation phase: ${state.phase}`);
  }

  async function runAutomation() {
    if (automationBusy) return;
    const state = readState();
    if (!state.running) return;

    automationBusy = true;
    try {
      const plan = state.plan;
      if (!plan || !Array.isArray(plan.drop) || !Array.isArray(plan.add)) {
        throw new Error("No execution plan is saved. Reset state and run the plan again.");
      }

      for (let step = 0; step < 50; step += 1) {
        const currentState = readState();
        if (!currentState.running) break;
        const shouldContinue = await advanceAutomation(currentState, plan);
        if (!shouldContinue) break;
      }
    } catch (error) {
      failAutomation(error);
    } finally {
      automationBusy = false;
    }
  }

  function preflightDrops(plan) {
    const missing = plan.drop.filter((subject) => !findCartRow(subject));
    if (missing.length > 0) {
      throw new Error(`Cannot find Drop subject(s) in the cart: ${missing.join(", ")}.`);
    }
  }

  function formatPlanSummary(plan) {
    const mode = isMockMode() ? "MOCK" : "LIVE";
    const drops = plan.drop.length > 0 ? plan.drop.join(", ") : "None";
    const additions =
      plan.add.length > 0
        ? plan.add
            .map(
              ({ subject, group, components }) =>
                `${subject} [group ${group}] (${components.join(", ")})`,
            )
            .join("\n")
        : "None";
    return [
      `${mode} subject registration plan`,
      "",
      `Drop: ${drops}`,
      "Add:",
      additions,
      "",
      "The script will stop at Preview and will never click Confirm.",
    ].join("\n");
  }

  function startAutomation() {
    try {
      const stored = savePlanText();
      const plan = parsePlan(stored.drop, stored.add);
      if (isPreviewPage()) {
        throw new Error("Click Modify before starting a new plan.");
      }
      preflightDrops(plan);
      if (!window.confirm(formatPlanSummary(plan))) return;

      const state = {
        running: true,
        phase: "drop",
        dropIndex: 0,
        addIndex: 0,
        pendingDrop: null,
        plan,
        message: "Starting plan...",
        error: null,
      };
      saveState(state);
      runAutomation();
    } catch (error) {
      failAutomation(error);
    }
  }

  function cancelAutomation() {
    const state = readState();
    state.running = false;
    state.phase = "cancelled";
    state.message = "Automation cancelled. No further page action will be taken.";
    state.error = null;
    saveState(state);
  }

  function resetAutomationState() {
    const state = defaultState();
    state.message = "Execution state reset. The Drop/Add text was preserved.";
    saveState(state);
  }

  function addStyles() {
    GM_addStyle(`
      #${PANEL_ID} {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        width: 360px;
        max-height: calc(100vh - 32px);
        overflow: auto;
        padding: 16px;
        border: 2px solid #991b1b;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25);
        color: #111827;
        font: 14px/1.4 Arial, sans-serif;
      }
      #${PANEL_ID}[hidden] { display: none; }
      #${PANEL_ID} h2 { margin: 0 0 4px; font-size: 18px; }
      #${PANEL_ID} .polyu-mode { margin-bottom: 12px; font-weight: 700; }
      #${PANEL_ID} .polyu-mode.live { color: #b91c1c; }
      #${PANEL_ID} label { display: block; margin-top: 10px; font-weight: 700; }
      #${PANEL_ID} textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 72px;
        margin-top: 4px;
        padding: 8px;
        resize: vertical;
        border: 1px solid #9ca3af;
        border-radius: 5px;
        font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #${PANEL_ID} #polyu-add-plan { min-height: 160px; }
      #${PANEL_ID} .polyu-help { margin: 4px 0 0; color: #4b5563; font-size: 12px; }
      #${PANEL_ID} .polyu-actions { display: flex; gap: 8px; margin-top: 12px; }
      #${PANEL_ID} button {
        padding: 8px 12px;
        border: 0;
        border-radius: 5px;
        background: #991b1b;
        color: #fff;
        cursor: pointer;
        font-weight: 700;
      }
      #${PANEL_ID} button.secondary { background: #4b5563; }
      #${PANEL_ID} button:disabled { cursor: not-allowed; opacity: 0.5; }
      #${PANEL_ID} .polyu-status {
        margin-top: 12px;
        padding: 9px;
        border-radius: 5px;
        background: #f3f4f6;
        white-space: pre-wrap;
      }
      #${PANEL_ID} .polyu-status[data-kind="error"] {
        background: #fee2e2;
        color: #991b1b;
      }
    `);
  }

  function createPanel() {
    const stored = readStoredPlanText();
    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <h2>Registration Helper</h2>
      <div class="polyu-mode ${isMockMode() ? "mock" : "live"}">
        ${isMockMode() ? "MOCK MODE" : "LIVE MODE"}
      </div>
      <label for="polyu-drop-plan">Drop subjects</label>
      <textarea id="polyu-drop-plan" placeholder="COMP3211"></textarea>
      <p class="polyu-help">One subject code per line.</p>
      <label for="polyu-add-plan">Add subjects by component</label>
      <textarea id="polyu-add-plan" placeholder="COMP3211 | 1011 | LTL001"></textarea>
      <p class="polyu-help">Format: SUBJECT | SUBJECT_GROUP | COMPONENT[, COMPONENT]</p>
      <div class="polyu-actions">
        <button type="button" id="polyu-run-plan">Run plan</button>
        <button type="button" id="polyu-cancel-plan" class="secondary">Stop</button>
        <button type="button" id="polyu-reset-state" class="secondary">Reset state</button>
      </div>
      <div class="polyu-status" role="status" aria-live="polite"></div>
    `;

    document.body.appendChild(panel);
    dropInput = panel.querySelector("#polyu-drop-plan");
    addInput = panel.querySelector("#polyu-add-plan");
    statusElement = panel.querySelector(".polyu-status");
    runButton = panel.querySelector("#polyu-run-plan");
    cancelButton = panel.querySelector("#polyu-cancel-plan");
    resetButton = panel.querySelector("#polyu-reset-state");
    dropInput.value = stored.drop || "";
    addInput.value = stored.add || "";
    runButton.addEventListener("click", startAutomation);
    cancelButton.addEventListener("click", cancelAutomation);
    resetButton.addEventListener("click", resetAutomationState);
    dropInput.addEventListener("change", savePlanText);
    addInput.addEventListener("change", savePlanText);
    updateControls();
  }

  function ensurePanelAttached() {
    if (!document.body || document.getElementById(PANEL_ID)) return;
    createPanel();
  }

  function installPanelRepairObserver() {
    const observer = new MutationObserver(() => {
      clearTimeout(panelRepairTimer);
      panelRepairTimer = window.setTimeout(() => {
        ensurePanelAttached();

        const state = readState();
        if (isPreviewPage() && state.running) {
          stopAtPreview();
          return;
        }

        if (state.running && !automationBusy) {
          runAutomation();
        }
      }, 100);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function initialize() {
    addStyles();
    ensurePanelAttached();
    installPanelRepairObserver();
    GM_registerMenuCommand("Toggle registration helper", () => {
      ensurePanelAttached();
      panel.hidden = !panel.hidden;
    });

    if (isPreviewPage()) {
      const state = readState();
      if (
        state.running ||
        state.phase === "awaiting-human-confirmation" ||
        state.phase === "preview-verification-failed"
      ) {
        stopAtPreview();
      } else {
        setStatus("Preview page detected. Confirm remains a manual action.");
      }
      return;
    }

    if (readState().running) {
      window.setTimeout(runAutomation, 300);
    }
  }

  initialize();
})();
