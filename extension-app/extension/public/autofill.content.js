"use strict";
(() => {
  // extension-app/extension/src/types/storage-schema.ts
  var STORAGE_DEFAULTS = {
    jobhelpConfigFileId: null,
    appsScriptUrl: null,
    anthropicApiKey: null,
    driveSourceFolderId: null,
    driveRulesFolderId: null,
    driveOutputFolderId: null,
    driveTemplateDocxId: null,
    sheetId: null,
    defaultGenerateModel: "claude-haiku-4-5-20251001",
    lastToggles: {},
    presets: [],
    onboardingState: "noConfig",
    lastJobInsights: null,
    lastDigest: null,
    v2Toggles: null,
    autofillProfile: null,
    autofillResumeDump: null
  };

  // extension-app/extension/src/lib/storage.ts
  function hasChromeStorage() {
    const c = globalThis.chrome;
    return !!c && !!c.storage && !!c.storage.local;
  }
  async function get(key) {
    if (!hasChromeStorage()) {
      return STORAGE_DEFAULTS[key];
    }
    const c = globalThis.chrome;
    const result = await c.storage.local.get(key);
    if (key in result && result[key] !== void 0) {
      return result[key];
    }
    return STORAGE_DEFAULTS[key];
  }
  async function set(key, value) {
    if (!hasChromeStorage()) {
      return;
    }
    const c = globalThis.chrome;
    await c.storage.local.set({ [key]: value });
  }

  // extension-app/extension/src/lib/greenhouse/mount.ts
  function remountIfDetached(panel, parent) {
    if (panel.isConnected) return false;
    parent.appendChild(panel);
    return true;
  }

  // extension-app/extension/src/lib/greenhouse/scanForm.ts
  function normalizeLabel(text) {
    return text.replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  }
  function labelText(root, id) {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
    const label = root.querySelector(`label[for="${escaped}"]`);
    return label ? normalizeLabel(label.textContent ?? "") : "";
  }
  function scanForm(root) {
    const controls = Array.from(
      root.querySelectorAll("input[id], select[id], textarea[id]")
    );
    const fields = [];
    for (const el of controls) {
      const id = el.getAttribute("id");
      if (!id) continue;
      const type = el.getAttribute("type") ?? el.tagName.toLowerCase();
      fields.push({
        id,
        label: labelText(root, id) || el.getAttribute("aria-label") || "",
        type,
        required: el.getAttribute("required") === "true" || el.getAttribute("aria-required") === "true",
        combobox: el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list"
      });
    }
    return fields;
  }

  // extension-app/extension/src/lib/greenhouse/classify.ts
  var RULES = [
    { concept: "firstName", match: (l, id) => id === "first_name" || l.includes("first name") },
    { concept: "lastName", match: (l, id) => id === "last_name" || l.includes("last name") },
    { concept: "email", match: (l, id) => id === "email" || l.includes("email") },
    {
      concept: "currentCompany",
      match: (l) => l.includes("current company") || l.includes("current employer") || l.includes("company name")
    },
    {
      concept: "currentTitle",
      match: (l) => l.includes("current title") || l.includes("current role") || l.includes("job title") || l.includes("current position")
    },
    { concept: "zip", match: (l) => l.includes("zip") || l.includes("postal") },
    { concept: "city", match: (l) => l.includes("city") },
    { concept: "state", match: (l) => l.includes("province") || /\bstate\b/.test(l) },
    { concept: "address", match: (l) => l.includes("address") },
    { concept: "linkedin", match: (l) => l.includes("linkedin") },
    { concept: "github", match: (l) => l.includes("github") },
    { concept: "portfolio", match: (l) => l.includes("portfolio") },
    { concept: "website", match: (l) => l.includes("website") || l.includes("personal site") },
    {
      concept: "school",
      match: (l) => l.includes("school") || l.includes("university") || l.includes("college")
    },
    { concept: "sponsorship", match: (l) => l.includes("sponsorship") || l.includes("sponsor") },
    {
      concept: "workAuthorization",
      match: (l) => l.includes("authorized to work") || l.includes("work authorization")
    },
    { concept: "country", match: (l, id) => id === "country" || l.includes("country") },
    { concept: "phone", match: (l, id) => id === "phone" || l.includes("phone") }
  ];
  function classifyField(field) {
    const label = field.label.toLowerCase();
    const id = field.id.toLowerCase();
    for (const rule of RULES) {
      if (rule.match(label, id)) return rule.concept;
    }
    return null;
  }

  // extension-app/extension/src/lib/greenhouse/autofill.ts
  function planAutofill(fields, profile) {
    const fills = [];
    const comboFills = [];
    const review = [];
    for (const field of fields) {
      if (field.type === "file") {
        review.push({ id: field.id, label: field.label, reason: "file" });
        continue;
      }
      const concept = classifyField(field);
      if (!concept) {
        review.push({ id: field.id, label: field.label, reason: "unknown" });
        continue;
      }
      const value = profile[concept];
      if (field.combobox) {
        if (value) comboFills.push({ id: field.id, value });
        else review.push({ id: field.id, label: field.label, reason: "combobox" });
        continue;
      }
      if (!value) {
        review.push({ id: field.id, label: field.label, reason: "no-value" });
        continue;
      }
      fills.push({ id: field.id, value });
    }
    return { fills, comboFills, review };
  }
  function reviewSummary(applied, review) {
    const filled = `Filled ${applied} field${applied === 1 ? "" : "s"}`;
    if (review.length === 0) return `${filled}. Nothing left for you.`;
    return `${filled}. ${review.length} still need you.`;
  }
  function runAutofill(root, profile) {
    const plan = planAutofill(scanForm(root), profile);
    return {
      applied: applyFills(plan.fills, root),
      comboFills: plan.comboFills,
      review: plan.review
    };
  }
  function applyFills(fills, root) {
    let applied = 0;
    for (const fill of fills) {
      const el = root.getElementById(fill.id);
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) continue;
      el.value = fill.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      applied += 1;
    }
    return applied;
  }

  // extension-app/extension/src/lib/greenhouse/profile.ts
  function resolveScalars(profile) {
    const { schools, ...scalars } = profile;
    const primary = schools && schools.length > 0 ? schools[0].school : void 0;
    if (!scalars.school && primary) scalars.school = primary;
    return scalars;
  }

  // extension-app/extension/src/lib/greenhouse/combobox.ts
  function matchOption(value, options) {
    const v = value.trim().toLowerCase();
    if (!v) return null;
    const norm = options.map((raw) => ({ raw, low: raw.toLowerCase() }));
    const exact = norm.find((o) => o.low === v);
    if (exact) return exact.raw;
    const starts = norm.filter((o) => o.low.startsWith(v));
    if (starts.length === 1) return starts[0].raw;
    const contains = norm.filter((o) => o.low.includes(v));
    if (contains.length === 1) return contains[0].raw;
    return null;
  }
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function waitForOptions(root, tries = 12) {
    for (let i = 0; i < tries; i++) {
      const opts = Array.from(root.querySelectorAll('[role="option"]'));
      if (opts.length > 0) return opts;
      await sleep(60);
    }
    return [];
  }
  async function fillCombobox(input, value, root) {
    if (!value.trim()) return false;
    input.focus();
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    setNativeValue(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const options = await waitForOptions(root);
    if (options.length === 0) {
      input.blur();
      return false;
    }
    const texts = options.map((o) => (o.textContent ?? "").trim());
    const match = matchOption(value, texts);
    if (!match) {
      input.blur();
      return false;
    }
    const target = options.find((o) => (o.textContent ?? "").trim() === match);
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.click();
    return true;
  }

  // extension-app/extension/src/autofill-panel.ts
  var PROFILE_FIELDS = [
    { key: "firstName", label: "First name" },
    { key: "lastName", label: "Last name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "address", label: "Street address" },
    { key: "city", label: "City" },
    { key: "state", label: "State / Province" },
    { key: "zip", label: "ZIP / Postal code" },
    { key: "country", label: "Country" },
    { key: "currentCompany", label: "Current company" },
    { key: "currentTitle", label: "Current title" },
    { key: "linkedin", label: "LinkedIn URL" },
    { key: "github", label: "GitHub URL" },
    { key: "portfolio", label: "Portfolio URL" },
    { key: "website", label: "Website" }
  ];
  var SCHOOL_FIELDS = [
    { key: "school", ph: "School" },
    { key: "degree", ph: "Degree" },
    { key: "field", ph: "Field" },
    { key: "endYear", ph: "Year" }
  ];
  var REASON_TEXT = {
    file: "attach manually",
    combobox: "pick from the dropdown",
    unknown: "needs your answer",
    "no-value": "not in your profile"
  };
  var PANEL_ID = "jobhelp-autofill-panel";
  function styled(tag, css, text) {
    const el = document.createElement(tag);
    Object.assign(el.style, css);
    if (text !== void 0) el.textContent = text;
    return el;
  }
  function debounced(fn, ms) {
    let timer;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }
  var SAVE_TAG = "[JobHelp autofill]";
  function persist(key, value) {
    void (async () => {
      try {
        await set(key, value);
        console.log(SAVE_TAG, "saved", key);
      } catch (err) {
        console.error(SAVE_TAG, "SAVE FAILED for", key, err);
      }
    })();
  }
  function renderReview(container, applied, review) {
    container.replaceChildren();
    container.appendChild(
      styled("div", { fontWeight: "600", margin: "8px 0 4px" }, reviewSummary(applied, review))
    );
    for (const item of review) {
      const label = item.label || item.id;
      container.appendChild(
        styled(
          "div",
          { fontSize: "12px", color: "#444", padding: "2px 0" },
          `\u2022 ${label} \u2014 ${REASON_TEXT[item.reason]}`
        )
      );
    }
  }
  function fieldLabel(labelText2) {
    const wrap = styled("label", { display: "block", marginBottom: "6px" });
    wrap.appendChild(styled("span", { display: "block", fontSize: "11px", color: "#666" }, labelText2));
    const input = styled("input", {
      width: "100%",
      boxSizing: "border-box",
      padding: "4px 6px",
      border: "1px solid #ddd",
      borderRadius: "4px"
    });
    input.type = "text";
    wrap.appendChild(input);
    return { wrap, input };
  }
  function buildSchoolsSection(draft, autosave) {
    const section = styled("div", { margin: "8px 0" });
    section.appendChild(
      styled("div", { fontSize: "11px", color: "#666", marginBottom: "4px" }, "Schools")
    );
    const rows = styled("div", {});
    section.appendChild(rows);
    const schools = draft.schools ? draft.schools.map((s) => ({ ...s })) : [];
    draft.schools = schools;
    function renderRow(entry, index) {
      const row = styled("div", { display: "flex", gap: "4px", marginBottom: "4px" });
      for (const { key, ph } of SCHOOL_FIELDS) {
        const inp = styled("input", {
          flex: key === "school" ? "2" : "1",
          minWidth: "0",
          boxSizing: "border-box",
          padding: "3px 5px",
          border: "1px solid #ddd",
          borderRadius: "4px",
          fontSize: "12px"
        });
        inp.type = "text";
        inp.placeholder = ph;
        inp.value = entry[key] ?? "";
        inp.addEventListener("input", () => {
          entry[key] = inp.value;
          autosave();
        });
        row.appendChild(inp);
      }
      const del = styled("button", {
        flex: "0 0 auto",
        padding: "0 6px",
        border: "1px solid #ccc",
        borderRadius: "4px",
        cursor: "pointer",
        background: "#f6f6f6"
      }, "\xD7");
      del.type = "button";
      del.addEventListener("click", () => {
        schools.splice(index, 1);
        autosave();
        redraw();
      });
      row.appendChild(del);
      return row;
    }
    function redraw() {
      rows.replaceChildren();
      schools.forEach((entry, i) => rows.appendChild(renderRow(entry, i)));
    }
    const addBtn = styled("button", {
      padding: "4px 8px",
      border: "1px solid #888",
      borderRadius: "4px",
      cursor: "pointer",
      background: "#f6f6f6",
      fontSize: "12px"
    }, "+ Add school");
    addBtn.type = "button";
    addBtn.addEventListener("click", () => {
      schools.push({ school: "" });
      autosave();
      redraw();
    });
    section.appendChild(addBtn);
    redraw();
    return section;
  }
  async function driveComboFills(comboFills) {
    let picked = 0;
    for (const c of comboFills) {
      const el = document.getElementById(c.id);
      if (!(el instanceof HTMLInputElement)) continue;
      try {
        if (await fillCombobox(el, c.value, document)) picked += 1;
      } catch {
      }
    }
    return picked;
  }
  function buildPanel(profile, resumeDump) {
    const draft = { ...profile };
    const autosave = debounced(() => persist("autofillProfile", { ...draft }), 400);
    const panel = styled("div", {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: "2147483647",
      width: "320px",
      maxHeight: "80vh",
      overflowY: "auto",
      padding: "12px",
      background: "#fff",
      border: "1px solid #ccc",
      borderRadius: "8px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
      font: "13px system-ui, sans-serif",
      color: "#111"
    });
    panel.id = PANEL_ID;
    panel.appendChild(styled("div", { fontWeight: "700", marginBottom: "8px" }, "JobHelp autofill"));
    for (const { key, label } of PROFILE_FIELDS) {
      const { wrap, input } = fieldLabel(label);
      input.value = draft[key] ?? "";
      input.addEventListener("input", () => {
        draft[key] = input.value;
        autosave();
      });
      panel.appendChild(wrap);
    }
    panel.appendChild(buildSchoolsSection(draft, autosave));
    const dumpWrap = styled("label", { display: "block", margin: "8px 0" });
    dumpWrap.appendChild(
      styled(
        "span",
        { display: "block", fontSize: "11px", color: "#666" },
        "Resume dump (grounds AI answers)"
      )
    );
    const dumpArea = styled("textarea", {
      width: "100%",
      boxSizing: "border-box",
      minHeight: "56px",
      resize: "vertical",
      padding: "4px 6px",
      border: "1px solid #ddd",
      borderRadius: "4px"
    });
    dumpArea.value = resumeDump;
    dumpArea.addEventListener("input", debounced(() => persist("autofillResumeDump", dumpArea.value), 400));
    dumpWrap.appendChild(dumpArea);
    panel.appendChild(dumpWrap);
    const btnRow = styled("div", { display: "flex", gap: "8px", margin: "10px 0" });
    const btnCss = {
      flex: "1",
      padding: "6px 8px",
      borderRadius: "4px",
      cursor: "pointer",
      border: "1px solid #888"
    };
    const saveBtn = styled("button", btnCss, "Save profile");
    saveBtn.type = "button";
    const fillBtn = styled(
      "button",
      { ...btnCss, background: "#2557d6", color: "#fff", borderColor: "#2557d6" },
      "Autofill this page"
    );
    fillBtn.type = "button";
    btnRow.append(saveBtn, fillBtn);
    panel.appendChild(btnRow);
    const reviewEl = styled("div", {});
    panel.appendChild(reviewEl);
    saveBtn.addEventListener("click", () => {
      persist("autofillProfile", { ...draft });
      saveBtn.textContent = "Saved";
      window.setTimeout(() => {
        saveBtn.textContent = "Save profile";
      }, 1200);
    });
    fillBtn.addEventListener("click", () => {
      persist("autofillProfile", { ...draft });
      const scalars = resolveScalars({ ...draft });
      const run = runAutofill(document, scalars);
      renderReview(reviewEl, run.applied, run.review);
      void driveComboFills(run.comboFills);
    });
    return panel;
  }

  // extension-app/extension/src/autofill-content.ts
  var TAG = "[JobHelp autofill]";
  function isApplicationPage() {
    return document.querySelector("#application-form, #first_name, input#email") !== null;
  }
  async function loadProfile() {
    return await get("autofillProfile") ?? {};
  }
  async function loadResumeDump() {
    return await get("autofillResumeDump") ?? "";
  }
  async function init() {
    console.log(TAG, "content script loaded on", location.href, "| top frame:", window.top === window);
    if (!isApplicationPage()) {
      console.log(TAG, "no application form detected on this page/frame \u2014 panel NOT injected");
      return;
    }
    if (document.getElementById(PANEL_ID)) return;
    const storageOk = !!globalThis.chrome?.storage?.local;
    const [profile, resumeDump] = await Promise.all([loadProfile(), loadResumeDump()]);
    console.log(
      TAG,
      "storage available:",
      storageOk,
      "| loaded profile keys:",
      Object.keys(profile),
      "| resumeDump chars:",
      resumeDump.length
    );
    const panel = buildPanel(profile, resumeDump);
    document.documentElement.appendChild(panel);
    const observer = new MutationObserver(() => {
      remountIfDetached(panel, document.documentElement);
    });
    observer.observe(document.documentElement, { childList: true });
    console.log(TAG, "panel injected (bottom-right)");
  }
  void init();
})();
//# sourceMappingURL=autofill.content.js.map
