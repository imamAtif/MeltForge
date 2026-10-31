/**
 * MeltForge Studio - Application Logic
 * Industrial DataOps interface for Singer taps/targets and Meltano GitOps.
 */

const state = {
  currentView: "pipelines",
  project: null,
  git: null,
  catalogStatus: null,
  extractors: [],
  loaders: [],
  wizard: {
    step: 1,
    sourceCategory: "All",
    targetCategory: "All",
    sourceQuery: "",
    targetQuery: "",
    selectedSource: null,
    selectedTarget: null,
    sourceConfig: {},
    sourceSecrets: {},
    targetConfig: {},
    targetSecrets: {},
    streams: []
  },
  activeRun: null,
  runTimer: null
};

const CATEGORIES = [
  "All",
  "Databases",
  "Data Warehouses",
  "CRM & Support",
  "Finance & Payments",
  "E-Commerce",
  "Marketing & Analytics",
  "Developer Tools",
  "Files & Storage",
  "Apps & APIs"
];

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  setupSyncControls();
  setupGitControls();
  setupTerminalDrawer();
  setupWizardControls();
  setupKeyboardShortcuts();

  await Promise.all([
    refreshAppState(),
    refreshCatalogStatus(),
    loadCatalog()
  ]);
  renderCurrentView();
});

// Keyboard Shortcut: press '/' to focus search input
function setupKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      e.preventDefault();
      const activeSearch = state.wizard.step === 1 
        ? document.getElementById("sourceSearchInput") 
        : document.getElementById("targetSearchInput");
      if (activeSearch && state.currentView === "builder") {
        activeSearch.focus();
      }
    }
  });
}

// Refresh Project & Git State from Backend
async function refreshAppState() {
  try {
    const [projectData, gitData] = await Promise.all([
      API.getProject(),
      API.getGitStatus()
    ]);
    state.project = projectData;
    state.git = gitData;
    updateGitHeaderUI();
  } catch (err) {
    console.error("Failed to load project state:", err);
  }
}

// Fetch Catalog Sync Status
async function refreshCatalogStatus() {
  try {
    const status = await API.getCatalogStatus();
    state.catalogStatus = status;
    
    const tapsCountEl = document.getElementById("tapsCountBadge");
    const targetsCountEl = document.getElementById("targetsCountBadge");
    const stepperTapsEl = document.getElementById("stepperTapsCount");
    const stepperTargetsEl = document.getElementById("stepperTargetsCount");
    const syncStatusEl = document.getElementById("syncStatusTimestamp");

    if (tapsCountEl) tapsCountEl.textContent = status.extractors_count;
    if (targetsCountEl) targetsCountEl.textContent = status.loaders_count;
    if (stepperTapsEl) stepperTapsEl.textContent = status.extractors_count;
    if (stepperTargetsEl) stepperTargetsEl.textContent = status.loaders_count;
    if (syncStatusEl) {
      syncStatusEl.textContent = `Synced: ${status.last_synced_extractors}`;
    }
  } catch (err) {
    console.warn("Catalog status fetch error:", err);
  }
}

// Load Catalog from Backend
async function loadCatalog() {
  try {
    const [extResp, ldrResp] = await Promise.all([
      API.listPlugins("extractors"),
      API.listPlugins("loaders")
    ]);
    state.extractors = extResp.plugins || [];
    state.loaders = ldrResp.plugins || [];
  } catch (err) {
    console.error("Failed to load catalog:", err);
  }
}

// Setup Dedicated Sync Taps & Sync Targets Buttons
function setupSyncControls() {
  const btnSyncTaps = document.getElementById("btnSyncTaps");
  const btnSyncTargets = document.getElementById("btnSyncTargets");

  btnSyncTaps.addEventListener("click", async () => {
    btnSyncTaps.classList.add("syncing");
    btnSyncTaps.disabled = true;
    try {
      const res = await API.syncTaps();
      await loadCatalog();
      await refreshCatalogStatus();
      renderSourceGrid();
      alert(res.message || "Taps synchronized successfully from Meltano Hub!");
    } catch (err) {
      alert("Failed to sync taps: " + err.message);
    } finally {
      btnSyncTaps.classList.remove("syncing");
      btnSyncTaps.disabled = false;
    }
  });

  btnSyncTargets.addEventListener("click", async () => {
    btnSyncTargets.classList.add("syncing");
    btnSyncTargets.disabled = true;
    try {
      const res = await API.syncTargets();
      await loadCatalog();
      await refreshCatalogStatus();
      renderTargetGrid();
      alert(res.message || "Targets synchronized successfully from Meltano Hub!");
    } catch (err) {
      alert("Failed to sync targets: " + err.message);
    } finally {
      btnSyncTargets.classList.remove("syncing");
      btnSyncTargets.disabled = false;
    }
  });
}

// Navigation Handling
function setupNavigation() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const view = tab.getAttribute("data-view");
      switchView(view);
    });
  });

  const btnNewCTA = document.getElementById("btnNewPipelineCTA");
  if (btnNewCTA) {
    btnNewCTA.addEventListener("click", () => switchView("builder"));
  }
}

function switchView(viewName) {
  state.currentView = viewName;
  document.querySelectorAll(".nav-tab").forEach(t => {
    t.classList.toggle("active", t.getAttribute("data-view") === viewName);
  });
  document.querySelectorAll(".view-section").forEach(s => {
    s.classList.toggle("active", s.id === `view-${viewName}`);
  });

  const breadcrumbEl = document.getElementById("breadcrumbSection");
  if (breadcrumbEl) {
    const titles = {
      pipelines: "Pipelines",
      builder: "Pipeline Studio",
      yaml: "meltano.yml",
      history: "Runs & Telemetry"
    };
    breadcrumbEl.textContent = titles[viewName] || viewName;
  }

  renderCurrentView();
}

function renderCurrentView() {
  if (state.currentView === "pipelines") renderPipelinesView();
  else if (state.currentView === "builder") renderWizardStep();
  else if (state.currentView === "yaml") renderYamlView();
  else if (state.currentView === "history") renderHistoryView();
}

// Update Git Status in Top Bar
function updateGitHeaderUI() {
  const branchLabel = document.getElementById("gitBranchName");
  const dot = document.getElementById("gitStatusDot");
  const changesContainer = document.getElementById("gitChangesContainer");
  const changesCount = document.getElementById("gitChangesCount");

  if (!state.git || !state.git.is_git) {
    branchLabel.textContent = "detached";
    dot.className = "git-dot";
    changesContainer.style.display = "none";
    return;
  }

  branchLabel.textContent = state.git.branch;
  if (state.git.clean) {
    dot.className = "git-dot";
    changesContainer.style.display = "none";
  } else {
    dot.className = "git-dot dirty";
    changesContainer.style.display = "block";
    changesCount.textContent = `${state.git.uncommitted_count} uncommitted`;
  }
}

// ==========================================
// 1. PIPELINES VIEW (HIGH DENSITY TABLE)
// ==========================================
async function renderPipelinesView() {
  const container = document.getElementById("pipelinesTableContainer");
  container.innerHTML = `<div style="color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; padding: 16px;">Querying meltano.yml pipelines...</div>`;

  try {
    const resp = await API.listPipelines();
    const pipelines = resp.pipelines || [];

    if (pipelines.length === 0) {
      container.innerHTML = `
        <div style="border: 1px dashed var(--border-default); border-radius: var(--radius-sm); padding: 48px 24px; text-align: center; background-color: var(--bg-panel);">
          <div style="font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">No Active Pipelines Defined</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">Configure an extractor and loader in the Studio, or define jobs in meltano.yml.</div>
          <button class="btn btn-primary" onclick="switchView('builder')">
            + Configure Pipeline
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <table class="pipeline-table">
        <thead>
          <tr>
            <th>Pipeline / Job ID</th>
            <th>Source Connector</th>
            <th></th>
            <th>Destination</th>
            <th>Specification</th>
            <th style="text-align: right;">Operations</th>
          </tr>
        </thead>
        <tbody>
          ${pipelines.map(pipe => {
            const extName = pipe.extractor || (pipe.tasks && pipe.tasks[0]?.split(" ")[0]) || "source";
            const ldrName = pipe.loader || (pipe.tasks && pipe.tasks[0]?.split(" ")[1]) || "destination";

            const extMeta = state.extractors.find(e => e.name === extName);
            const ldrMeta = state.loaders.find(l => l.name === ldrName);

            const extLogo = extMeta?.logo_url || `https://hub.meltano.com/assets/logos/extractors/${extName.replace('tap-', '')}.png`;
            const ldrLogo = ldrMeta?.logo_url || `https://hub.meltano.com/assets/logos/loaders/${ldrName.replace('target-', '')}.png`;

            return `
              <tr>
                <td>
                  <span class="tag-mono" style="font-weight: 600; color: var(--text-main);">${pipe.id || pipe.name}</span>
                </td>
                <td>
                  <div class="plug-node">
                    <img src="${extLogo}" class="plug-logo-img" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\'><rect fill=\\'%23e28437\\' width=\\'24\\' height=\\'24\\' rx=\\'2\\'/><text x=\\'12\\' y=\\'16\\' font-size=\\'12\\' fill=\\'black\\' text-anchor=\\'middle\\' font-weight=\\'bold\\'>T</text></svg>'">
                    <div>
                      <div class="plug-name">${extName}</div>
                      <div style="font-size: 10px; color: var(--text-muted);">${extMeta?.label || 'Singer Tap'}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="flow-arrow-icon"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </td>
                <td>
                  <div class="plug-node">
                    <img src="${ldrLogo}" class="plug-logo-img" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\'><rect fill=\\'%2338bdf8\\' width=\\'24\\' height=\\'24\\' rx=\\'2\\'/><text x=\\'12\\' y=\\'16\\' font-size=\\'12\\' fill=\\'black\\' text-anchor=\\'middle\\' font-weight=\\'bold\\'>L</text></svg>'">
                    <div>
                      <div class="plug-name">${ldrName}</div>
                      <div style="font-size: 10px; color: var(--text-muted);">${ldrMeta?.label || 'Singer Target'}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span class="tag-mono">meltano run ${extName} ${ldrName}</span>
                </td>
                <td style="text-align: right;">
                  <button class="btn btn-primary btn-sm" onclick="triggerPipelineRun('${extName}', '${ldrName}')">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    Run
                  </button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color: var(--color-error); font-family: var(--font-mono); font-size: 12px;">Failed to load pipelines: ${err.message}</div>`;
  }
}

// ==========================================
// 2. PIPELINE BUILDER (STEPPER)
// ==========================================
function setupWizardControls() {
  const btnNext = document.getElementById("btnWizardNext");
  const btnBack = document.getElementById("btnWizardBack");
  const btnCancel = document.getElementById("btnWizardCancel");

  btnNext.addEventListener("click", () => handleWizardNext());
  btnBack.addEventListener("click", () => handleWizardBack());
  btnCancel.addEventListener("click", () => {
    resetWizard();
    switchView("pipelines");
  });

  const srcSearch = document.getElementById("sourceSearchInput");
  srcSearch.addEventListener("input", (e) => {
    state.wizard.sourceQuery = e.target.value;
    renderSourceGrid();
  });

  const tgtSearch = document.getElementById("targetSearchInput");
  tgtSearch.addEventListener("input", (e) => {
    state.wizard.targetQuery = e.target.value;
    renderTargetGrid();
  });

  renderCategoryPills("sourceCategoryPills", (cat) => {
    state.wizard.sourceCategory = cat;
    renderSourceGrid();
  });

  renderCategoryPills("targetCategoryPills", (cat) => {
    state.wizard.targetCategory = cat;
    renderTargetGrid();
  });

  document.getElementById("btnTestConnection").addEventListener("click", runConnectionTest);
  document.getElementById("btnRefreshStreams").addEventListener("click", loadDiscoveredStreams);

  document.getElementById("selectAllStreams").addEventListener("change", (e) => {
    const checked = e.target.checked;
    document.querySelectorAll(".stream-checkbox").forEach(cb => {
      cb.checked = checked;
    });
  });
}

function renderCategoryPills(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = CATEGORIES.map((cat, i) => `
    <button class="cat-btn ${i === 0 ? 'active' : ''}" data-cat="${cat}">${cat}</button>
  `).join("");

  container.querySelectorAll(".cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      onSelect(btn.getAttribute("data-cat"));
    });
  });
}

function resetWizard() {
  state.wizard = {
    step: 1,
    sourceCategory: "All",
    targetCategory: "All",
    sourceQuery: "",
    targetQuery: "",
    selectedSource: null,
    selectedTarget: null,
    sourceConfig: {},
    sourceSecrets: {},
    targetConfig: {},
    targetSecrets: {},
    streams: []
  };
}

function renderWizardStep() {
  const step = state.wizard.step;

  for (let i = 1; i <= 4; i++) {
    const ind = document.getElementById(`stepIndicator${i}`);
    const content = document.getElementById(`stepContent${i}`);
    ind.classList.toggle("active", i === step);
    ind.classList.toggle("completed", i < step);
    content.style.display = i === step ? "block" : "none";
  }

  const btnBack = document.getElementById("btnWizardBack");
  const btnNext = document.getElementById("btnWizardNext");

  btnBack.disabled = step === 1;

  if (step === 1) {
    btnNext.disabled = !state.wizard.selectedSource;
    btnNext.textContent = "Select Destination →";
    renderSourceGrid();
  } else if (step === 2) {
    btnNext.disabled = !state.wizard.selectedTarget;
    btnNext.textContent = "Configure Parameters →";
    renderTargetGrid();
  } else if (step === 3) {
    btnNext.disabled = false;
    btnNext.textContent = "Select Schema Streams →";
    renderStep3Forms();
  } else if (step === 4) {
    btnNext.disabled = false;
    btnNext.textContent = "Commit to meltano.yml";
    renderStep4Streams();
  }
}

function renderSourceGrid() {
  const grid = document.getElementById("sourcePluginsGrid");
  const filterCountEl = document.getElementById("sourceFilterCount");
  const query = (state.wizard.sourceQuery || "").toLowerCase().trim();
  const cat = state.wizard.sourceCategory;

  let filtered = state.extractors.filter(p => {
    const matchesQuery = !query || p.name.toLowerCase().includes(query) || p.label.toLowerCase().includes(query);
    const matchesCat = cat === "All" || p.category === cat;
    return matchesQuery && matchesCat;
  });

  filterCountEl.textContent = `Showing ${filtered.length} of ${state.extractors.length} extractors`;

  // Display top 100 to prevent heavy DOM rendering while allowing fast pagination
  const displayItems = filtered.slice(0, 100);

  grid.innerHTML = displayItems.map(p => `
    <div class="connector-card ${state.wizard.selectedSource?.name === p.name ? 'selected' : ''}" onclick="selectSourcePlugin('${p.name}')">
      <div class="connector-card-top">
        <div class="connector-card-identity">
          <img src="${p.logo_url}" class="plug-logo-img" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\'><rect fill=\\'%23232836\\' width=\\'24\\' height=\\'24\\' rx=\\'2\\'/><text x=\\'12\\' y=\\'16\\' font-size=\\'12\\' fill=\\'%23e28437\\' text-anchor=\\'middle\\' font-weight=\\'bold\\'>T</text></svg>'">
          <div>
            <div class="connector-card-name">${p.name}</div>
            <div style="font-size: 10px; color: var(--text-muted);">${p.label}</div>
          </div>
        </div>
        <span class="tag-variant">${p.default_variant || 'default'}</span>
      </div>

      <div class="connector-card-desc">${p.description}</div>

      <div class="connector-card-meta">
        <span class="tag-mono" style="font-size: 10px;">${p.category || 'Connector'}</span>
        ${state.wizard.selectedSource?.name === p.name ? '<span class="tag-variant" style="color: var(--color-success); border-color: var(--color-success-border); background-color: var(--color-success-bg);">Selected</span>' : ''}
      </div>
    </div>
  `).join("");
}

function selectSourcePlugin(name) {
  state.wizard.selectedSource = state.extractors.find(p => p.name === name);
  document.getElementById("btnWizardNext").disabled = false;
  renderSourceGrid();
}

function renderTargetGrid() {
  const grid = document.getElementById("targetPluginsGrid");
  const filterCountEl = document.getElementById("targetFilterCount");
  const query = (state.wizard.targetQuery || "").toLowerCase().trim();
  const cat = state.wizard.targetCategory;

  let filtered = state.loaders.filter(p => {
    const matchesQuery = !query || p.name.toLowerCase().includes(query) || p.label.toLowerCase().includes(query);
    const matchesCat = cat === "All" || p.category === cat;
    return matchesQuery && matchesCat;
  });

  filterCountEl.textContent = `Showing ${filtered.length} of ${state.loaders.length} destinations`;

  grid.innerHTML = filtered.map(p => `
    <div class="connector-card ${state.wizard.selectedTarget?.name === p.name ? 'selected' : ''}" onclick="selectTargetPlugin('${p.name}')">
      <div class="connector-card-top">
        <div class="connector-card-identity">
          <img src="${p.logo_url}" class="plug-logo-img" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\'><rect fill=\\'%23232836\\' width=\\'24\\' height=\\'24\\' rx=\\'2\\'/><text x=\\'12\\' y=\\'16\\' font-size=\\'12\\' fill=\\'%2338bdf8\\' text-anchor=\\'middle\\' font-weight=\\'bold\\'>L</text></svg>'">
          <div>
            <div class="connector-card-name">${p.name}</div>
            <div style="font-size: 10px; color: var(--text-muted);">${p.label}</div>
          </div>
        </div>
        <span class="tag-variant">${p.default_variant || 'default'}</span>
      </div>

      <div class="connector-card-desc">${p.description}</div>

      <div class="connector-card-meta">
        <span class="tag-mono" style="font-size: 10px;">${p.category || 'Warehouse'}</span>
        ${state.wizard.selectedTarget?.name === p.name ? '<span class="tag-variant" style="color: var(--engine-cyan); border-color: rgba(56, 189, 248, 0.3); background-color: var(--engine-cyan-subtle);">Selected</span>' : ''}
      </div>
    </div>
  `).join("");
}

function selectTargetPlugin(name) {
  state.wizard.selectedTarget = state.loaders.find(p => p.name === name);
  document.getElementById("btnWizardNext").disabled = false;
  renderTargetGrid();
}

// Step 3: Parameters Form
async function renderStep3Forms() {
  const src = state.wizard.selectedSource;
  const tgt = state.wizard.selectedTarget;

  document.getElementById("configStepHeader").textContent = `${src.name} → ${tgt.name}`;
  document.getElementById("sourceParamHeading").textContent = `Source Configuration: ${src.name}`;
  document.getElementById("targetParamHeading").textContent = `Destination Configuration: ${tgt.name}`;

  const [srcDetails, tgtDetails] = await Promise.all([
    API.getPluginDetails("extractors", src.name, src.default_variant),
    API.getPluginDetails("loaders", tgt.name, tgt.default_variant)
  ]);

  renderFormFields("sourceFormGrid", srcDetails.settings || [], "source");
  renderFormFields("targetFormGrid", tgtDetails.settings || [], "target");
}

function renderFormFields(containerId, settings, typePrefix) {
  const container = document.getElementById(containerId);
  if (!settings || settings.length === 0) {
    container.innerHTML = `<div style="font-family: var(--font-mono); color: var(--text-muted); font-size: 11px;">Zero required configuration parameters.</div>`;
    return;
  }

  container.innerHTML = settings.map(s => {
    const isSecret = s.secret || s.kind === "password";
    const inputType = isSecret ? "password" : (s.kind === "integer" ? "number" : "text");
    const defaultValue = s.value !== undefined && s.value !== null ? s.value : "";
    const inputId = `${typePrefix}_${s.name.replace(/\./g, '_')}`;

    if (s.kind === "options" && s.options) {
      return `
        <div class="form-item">
          <div class="form-label-line">
            <label class="form-label" for="${inputId}">config.${s.name}</label>
          </div>
          <select class="form-control form-field" id="${inputId}" data-name="${s.name}" data-secret="${isSecret}" data-type="${typePrefix}">
            ${s.options.map(opt => `<option value="${opt}" ${opt === defaultValue ? 'selected' : ''}>${opt}</option>`).join("")}
          </select>
          ${s.description ? `<div class="form-help">${s.description}</div>` : ''}
        </div>
      `;
    }

    return `
      <div class="form-item ${s.kind === 'string' && s.description?.length > 100 ? 'form-row-full' : ''}">
        <div class="form-label-line">
          <label class="form-label" for="${inputId}">${typePrefix === 'source' ? 'config' : 'target'}.${s.name}</label>
          ${isSecret ? '<span class="secret-tag">ENV SECRET</span>' : ''}
        </div>
        <input 
          type="${inputType}" 
          class="form-control form-field" 
          id="${inputId}" 
          data-name="${s.name}" 
          data-secret="${isSecret}"
          data-type="${typePrefix}"
          placeholder="${s.placeholder || ''}" 
          value="${defaultValue}"
        >
        ${s.description ? `<div class="form-help">${s.description}</div>` : ''}
      </div>
    `;
  }).join("");
}

function collectFormValues() {
  const fields = document.querySelectorAll(".form-field");
  fields.forEach(field => {
    const name = field.getAttribute("data-name");
    const isSecret = field.getAttribute("data-secret") === "true";
    const typePrefix = field.getAttribute("data-type");
    const value = field.value;

    if (typePrefix === "source") {
      if (isSecret) state.wizard.sourceSecrets[name] = value;
      else state.wizard.sourceConfig[name] = value;
    } else {
      if (isSecret) state.wizard.targetSecrets[name] = value;
      else state.wizard.targetConfig[name] = value;
    }
  });
}

async function runConnectionTest() {
  collectFormValues();
  const alertBox = document.getElementById("connectionTestAlert");
  alertBox.style.display = "block";
  alertBox.style.backgroundColor = "var(--bg-panel-elevated)";
  alertBox.style.color = "var(--text-muted)";
  alertBox.style.border = "1px solid var(--border-default)";
  alertBox.textContent = "Running test connection against connector...";

  try {
    const src = state.wizard.selectedSource;
    await API.savePlugin({
      plugin_type: "extractors",
      name: src.name,
      variant: src.variant || src.default_variant,
      pip_url: src.pip_url,
      config: state.wizard.sourceConfig,
      secrets: state.wizard.sourceSecrets
    });

    const res = await API.testConnection("extractors", src.name);
    if (res.success) {
      alertBox.style.backgroundColor = "var(--color-success-bg)";
      alertBox.style.color = "var(--color-success)";
      alertBox.style.border = "1px solid var(--color-success-border)";
      alertBox.textContent = `SUCCESS: ${res.message}`;
    } else {
      alertBox.style.backgroundColor = "var(--color-warning-bg)";
      alertBox.style.color = "var(--color-warning)";
      alertBox.style.border = "1px solid var(--color-warning-border)";
      alertBox.textContent = `NOTICE: ${res.message}`;
    }
  } catch (err) {
    alertBox.style.backgroundColor = "var(--color-error-bg)";
    alertBox.style.color = "var(--color-error)";
    alertBox.style.border = "1px solid var(--color-error-border)";
    alertBox.textContent = `ERROR: ${err.message}`;
  }
}

// Step 4: Stream Discovery & Selection
async function renderStep4Streams() {
  await loadDiscoveredStreams();
}

async function loadDiscoveredStreams() {
  const container = document.getElementById("streamsList");
  container.innerHTML = `<div style="padding: 12px; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">Running catalog discovery on ${state.wizard.selectedSource.name}...</div>`;

  try {
    const resp = await API.discoverStreams(state.wizard.selectedSource.name);
    state.wizard.streams = resp.streams || [];
    document.getElementById("streamsCountBadge").textContent = `${state.wizard.streams.length} streams discovered`;

    container.innerHTML = state.wizard.streams.map(s => `
      <div class="stream-item">
        <label class="stream-toggle">
          <input type="checkbox" class="stream-checkbox" data-stream="${s.name}" ${s.selected ? 'checked' : ''}>
          <span style="font-weight: 600; color: var(--text-main);">${s.name}</span>
          <span class="tag-mono" style="font-size: 10px;">${s.properties?.length || 0} fields</span>
        </label>
        <div style="display: flex; gap: 4px; max-width: 320px; flex-wrap: wrap;">
          ${(s.properties || []).slice(0, 3).map(p => `<span class="tag-mono" style="font-size: 9px;">${p.name}</span>`).join("")}
          ${(s.properties?.length || 0) > 3 ? `<span class="tag-mono" style="font-size: 9px;">+${s.properties.length - 3}</span>` : ''}
        </div>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<div style="padding: 12px; color: var(--color-error); font-family: var(--font-mono); font-size: 11px;">Discovery failed: ${err.message}</div>`;
  }
}

async function handleWizardNext() {
  if (state.wizard.step === 1) {
    state.wizard.step = 2;
    renderWizardStep();
  } else if (state.wizard.step === 2) {
    state.wizard.step = 3;
    renderWizardStep();
  } else if (state.wizard.step === 3) {
    collectFormValues();
    state.wizard.step = 4;
    renderWizardStep();
  } else if (state.wizard.step === 4) {
    await saveNewPipeline();
  }
}

function handleWizardBack() {
  if (state.wizard.step > 1) {
    state.wizard.step -= 1;
    renderWizardStep();
  }
}

async function saveNewPipeline() {
  const src = state.wizard.selectedSource;
  const tgt = state.wizard.selectedTarget;

  const selectedStreamCheckboxes = document.querySelectorAll(".stream-checkbox:checked");
  const selectedStreams = Array.from(selectedStreamCheckboxes).map(cb => cb.getAttribute("data-stream"));
  const selectRules = selectedStreams.map(s => `${s}.*`);

  try {
    await API.savePlugin({
      plugin_type: "extractors",
      name: src.name,
      variant: src.variant || src.default_variant,
      pip_url: src.pip_url,
      config: state.wizard.sourceConfig,
      secrets: state.wizard.sourceSecrets,
      select: selectRules.length > 0 ? selectRules : ["*.*"]
    });

    await API.savePlugin({
      plugin_type: "loaders",
      name: tgt.name,
      variant: tgt.variant || tgt.default_variant,
      pip_url: tgt.pip_url,
      config: state.wizard.targetConfig,
      secrets: state.wizard.targetSecrets
    });

    try {
      await API.gitCommit(`feat(pipeline): configure ${src.name} to ${tgt.name}`);
    } catch (e) {
      console.warn("Git commit skipped:", e);
    }

    await refreshAppState();
    resetWizard();
    switchView("pipelines");
  } catch (err) {
    alert("Failed to save pipeline: " + err.message);
  }
}

// ==========================================
// 3. YAML INSPECTOR
// ==========================================
async function renderYamlView() {
  const pre = document.getElementById("rawYamlDisplay");
  pre.textContent = "Reading meltano.yml...";

  try {
    const data = await API.getProject();
    pre.textContent = data.raw_yaml || "# meltano.yml not initialized";
    document.getElementById("secretsCountBadge").textContent = `${data.secrets_keys?.length || 0} env variables in .env`;

    document.getElementById("btnCopyYaml").onclick = () => {
      navigator.clipboard.writeText(data.raw_yaml || "");
      alert("YAML copied to clipboard.");
    };

    document.getElementById("btnSaveYaml").onclick = () => openCommitModal();
    document.getElementById("btnRevertYaml").onclick = async () => {
      if (confirm("Discard all uncommitted changes in meltano.yml?")) {
        await API.gitRevert();
        await refreshAppState();
        renderYamlView();
      }
    };
  } catch (err) {
    pre.textContent = "Error: " + err.message;
  }
}

// ==========================================
// 4. RUNS & TELEMETRY VIEW
// ==========================================
async function renderHistoryView() {
  const container = document.getElementById("runsHistoryTableContainer");
  container.innerHTML = `<div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); padding: 14px;">Loading telemetry records...</div>`;

  try {
    const resp = await API.listRuns();
    const runs = resp.runs || [];

    if (runs.length === 0) {
      container.innerHTML = `
        <div style="border: 1px dashed var(--border-default); border-radius: var(--radius-sm); padding: 36px; text-align: center; background-color: var(--bg-panel);">
          <div style="font-family: var(--font-mono); font-size: 12px; color: var(--text-muted);">No pipeline executions logged yet.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <table class="pipeline-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Command</th>
            <th>Pipeline</th>
            <th>Execution Time</th>
            <th>Duration</th>
            <th style="text-align: right;">Logs</th>
          </tr>
        </thead>
        <tbody>
          ${runs.map(r => `
            <tr>
              <td>
                <span class="tag-mono" style="color: ${r.status === 'SUCCESS' ? 'var(--color-success)' : (r.status === 'RUNNING' ? 'var(--color-warning)' : 'var(--color-error)')};">
                  ${r.status}
                </span>
              </td>
              <td><span class="tag-mono">${r.command}</span></td>
              <td><strong style="font-family: var(--font-mono); font-size: 12px;">${r.pipeline_name}</strong></td>
              <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">${r.start_time}</td>
              <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">${r.duration_seconds}s</td>
              <td style="text-align: right;">
                <button class="btn btn-secondary btn-sm" onclick="openTerminalForRun('${r.run_id}', '${r.pipeline_name}')">
                  Logs (${r.log_count})
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color: var(--color-error); font-family: var(--font-mono); font-size: 11px;">Error: ${err.message}</div>`;
  }
}

// ==========================================
// 5. TERMINAL DOCK & LOG STREAMING
// ==========================================
function setupTerminalDrawer() {
  const header = document.getElementById("terminalHeader");
  const drawer = document.getElementById("terminalDrawer");
  const btnClose = document.getElementById("btnCloseTerminal");
  const btnMin = document.getElementById("btnToggleTerminalMinimize");

  btnClose.addEventListener("click", (e) => {
    e.stopPropagation();
    drawer.classList.add("closed");
  });

  btnMin.addEventListener("click", (e) => {
    e.stopPropagation();
    drawer.classList.toggle("minimized");
  });

  header.addEventListener("click", () => {
    drawer.classList.toggle("minimized");
  });
}

function triggerPipelineRun(extractor, loader) {
  const drawer = document.getElementById("terminalDrawer");
  const logsBody = document.getElementById("terminalLogsBody");
  const title = document.getElementById("terminalPipelineTitle");
  const statusDot = document.getElementById("runStatusIndicator");
  const durationLabel = document.getElementById("terminalRunDuration");

  drawer.classList.remove("closed", "minimized");
  logsBody.innerHTML = "";
  title.textContent = `meltano run ${extractor} ${loader}`;
  statusDot.className = "git-dot dirty";

  const startTime = Date.now();
  if (state.runTimer) clearInterval(state.runTimer);
  state.runTimer = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    durationLabel.textContent = `${elapsed}s`;
  }, 200);

  API.runPipeline(extractor, loader).then(resp => {
    state.activeRun = resp.run_id;
    API.connectRunWebSocket(resp.run_id, (log) => {
      appendTerminalLog(log);
    }, (finalStatus) => {
      clearInterval(state.runTimer);
      statusDot.className = finalStatus === "SUCCESS" ? "git-dot" : "git-dot dirty";
      statusDot.style.backgroundColor = finalStatus === "SUCCESS" ? "var(--color-success)" : "var(--color-error)";
      refreshAppState();
    });
  }).catch(err => {
    clearInterval(state.runTimer);
    appendTerminalLog({ timestamp: "--:--:--", stream: "system", message: "Failed to start pipeline: " + err.message });
  });
}

function openTerminalForRun(runId, pipelineName) {
  const drawer = document.getElementById("terminalDrawer");
  const logsBody = document.getElementById("terminalLogsBody");
  const title = document.getElementById("terminalPipelineTitle");

  drawer.classList.remove("closed", "minimized");
  logsBody.innerHTML = `<div style="color: var(--text-muted); font-family: var(--font-mono); font-size: 11px;">Fetching run logs for ${runId}...</div>`;
  title.textContent = pipelineName;

  API.getRunDetails(runId).then(details => {
    logsBody.innerHTML = "";
    (details.logs || []).forEach(l => appendTerminalLog(l));
  });
}

function appendTerminalLog(log) {
  const logsBody = document.getElementById("terminalLogsBody");
  const row = document.createElement("div");
  row.className = "dock-line";
  const streamClass = `dock-${log.stream || 'stdout'}`;
  row.innerHTML = `
    <span class="dock-time">[${log.timestamp || '--:--:--'}]</span>
    <span class="${streamClass}">${escapeHtml(log.message || '')}</span>
  `;
  logsBody.appendChild(row);
  logsBody.scrollTop = logsBody.scrollHeight;
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ==========================================
// 6. GIT OPERATIONS
// ==========================================
function setupGitControls() {
  const btnCommit = document.getElementById("btnGitCommit");
  const btnPull = document.getElementById("btnGitPull");
  const modal = document.getElementById("commitModal");
  const btnClose = document.getElementById("btnCloseCommitModal");
  const btnCancel = document.getElementById("btnCancelCommitModal");
  const btnConfirm = document.getElementById("btnConfirmCommit");

  btnCommit.addEventListener("click", openCommitModal);
  btnClose.addEventListener("click", () => modal.style.display = "none");
  btnCancel.addEventListener("click", () => modal.style.display = "none");

  btnConfirm.addEventListener("click", async () => {
    const msg = document.getElementById("commitMessageInput").value.trim() || "chore: update meltano.yml";
    try {
      const res = await API.gitCommit(msg);
      modal.style.display = "none";
      alert(res.message || "Git commit successful.");
      await refreshAppState();
    } catch (e) {
      alert("Commit failed: " + e.message);
    }
  });

  btnPull.addEventListener("click", async () => {
    try {
      const res = await API.gitPull();
      alert(res.message || "Git pull completed.");
      await refreshAppState();
      renderCurrentView();
    } catch (e) {
      alert("Pull failed: " + e.message);
    }
  });
}

function openCommitModal() {
  const modal = document.getElementById("commitModal");
  document.getElementById("modalBranchLabel").textContent = state.git?.branch || "main";
  modal.style.display = "flex";
}
