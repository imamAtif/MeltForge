/**
 * MeltForge - Main Application Logic
 * Implements GitOps-backed visual workflow for Meltano pipelines.
 */

// Application State
const state = {
  currentView: "pipelines",
  project: null,
  git: null,
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
  setupGitControls();
  setupTerminalDrawer();
  setupWizardControls();

  await refreshAppState();
  await loadCatalog();
  renderCurrentView();
});

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

// Load Available Plugins for Wizard (All 655+ Taps and 50+ Targets)
async function loadCatalog() {
  try {
    const [extResp, ldrResp] = await Promise.all([
      API.listPlugins("extractors"),
      API.listPlugins("loaders")
    ]);
    state.extractors = extResp.plugins || [];
    state.loaders = ldrResp.plugins || [];

    const srcCountBadge = document.getElementById("sourceCatalogCount");
    const tgtCountBadge = document.getElementById("targetCatalogCount");
    if (srcCountBadge) srcCountBadge.textContent = state.extractors.length;
    if (tgtCountBadge) tgtCountBadge.textContent = state.loaders.length;
  } catch (err) {
    console.error("Failed to load catalog:", err);
  }
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
    branchLabel.textContent = "no git repo";
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
// 1. PIPELINES VIEW
// ==========================================
async function renderPipelinesView() {
  const container = document.getElementById("pipelinesList");
  container.innerHTML = `<div style="color: var(--text-muted); padding: 24px;">Loading pipelines...</div>`;

  try {
    const resp = await API.listPipelines();
    const pipelines = resp.pipelines || [];

    if (pipelines.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <h3 class="empty-state-title">No Pipelines Configured Yet</h3>
          <p class="empty-state-desc">Create your first data extraction & loading pipeline using our visual builder.</p>
          <button class="btn btn-primary" onclick="switchView('builder')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Build First Pipeline
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = pipelines.map(pipe => {
      const extName = pipe.extractor || (pipe.tasks && pipe.tasks[0]?.split(" ")[0]) || "source";
      const ldrName = pipe.loader || (pipe.tasks && pipe.tasks[0]?.split(" ")[1]) || "destination";

      const extMeta = state.extractors.find(e => e.name === extName);
      const ldrMeta = state.loaders.find(l => l.name === ldrName);

      const extLogo = extMeta?.logo_url || `https://hub.meltano.com/assets/logos/extractors/${extName.replace('tap-', '')}.png`;
      const ldrLogo = ldrMeta?.logo_url || `https://hub.meltano.com/assets/logos/loaders/${ldrName.replace('target-', '')}.png`;

      return `
        <div class="pipeline-card">
          <div class="pipeline-visual-flow">
            <div class="node-box">
              <img src="${extLogo}" class="node-logo" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\'><rect fill=\\'%23f97316\\' width=\\'24\\' height=\\'24\\' rx=\\'4\\'/><text x=\\'12\\' y=\\'16\\' font-size=\\'12\\' fill=\\'white\\' text-anchor=\\'middle\\' font-weight=\\'bold\\'>T</text></svg>'">
              <div>
                <div class="node-info-name">${extMeta?.label || extName}</div>
                <div class="node-info-role">Source</div>
              </div>
            </div>

            <div class="flow-arrow">
              <span class="badge badge-neutral" style="font-size: 10px;">Singer ELT</span>
              <div class="flow-line"></div>
            </div>

            <div class="node-box">
              <img src="${ldrLogo}" class="node-logo" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\'><rect fill=\\'%2338bdf8\\' width=\\'24\\' height=\\'24\\' rx=\\'4\\'/><text x=\\'12\\' y=\\'16\\' font-size=\\'12\\' fill=\\'white\\' text-anchor=\\'middle\\' font-weight=\\'bold\\'>L</text></svg>'">
              <div>
                <div class="node-info-name">${ldrMeta?.label || ldrName}</div>
                <div class="node-info-role">Destination</div>
              </div>
            </div>
          </div>

          <div class="pipeline-actions">
            <button class="btn btn-secondary btn-sm" onclick="configureExistingPipeline('${extName}', '${ldrName}')">
              Configure
            </button>
            <button class="btn btn-primary btn-sm" onclick="triggerPipelineRun('${extName}', '${ldrName}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              Run Now
            </button>
          </div>
        </div>
      `;
    }).join("");

  } catch (err) {
    container.innerHTML = `<div style="color: var(--status-error); padding: 20px;">Error loading pipelines: ${err.message}</div>`;
  }
}

// ==========================================
// 2. PIPELINE BUILDER (WIZARD)
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

  // Source Search & Categories
  const srcSearch = document.getElementById("sourceSearchInput");
  srcSearch.addEventListener("input", (e) => {
    state.wizard.sourceQuery = e.target.value;
    renderSourceGrid();
  });

  // Target Search & Categories
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
    <button class="cat-pill ${i === 0 ? 'active' : ''}" data-cat="${cat}">${cat}</button>
  `).join("");

  container.querySelectorAll(".cat-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      container.querySelectorAll(".cat-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      onSelect(pill.getAttribute("data-cat"));
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
    btnNext.textContent = "Select Destination ➔";
    renderSourceGrid();
  } else if (step === 2) {
    btnNext.disabled = !state.wizard.selectedTarget;
    btnNext.textContent = "Configure Settings ➔";
    renderTargetGrid();
  } else if (step === 3) {
    btnNext.disabled = false;
    btnNext.textContent = "Select Tables & Streams ➔";
    renderStep3Forms();
  } else if (step === 4) {
    btnNext.disabled = false;
    btnNext.textContent = "Save & Commit to meltano.yml ✨";
    renderStep4Streams();
  }
}

function renderSourceGrid() {
  const grid = document.getElementById("sourcePluginsGrid");
  const statsLabel = document.getElementById("sourceStatsLabel");
  const query = (state.wizard.sourceQuery || "").toLowerCase().trim();
  const cat = state.wizard.sourceCategory;

  let filtered = state.extractors.filter(p => {
    const matchesQuery = !query || p.name.toLowerCase().includes(query) || p.label.toLowerCase().includes(query);
    const matchesCat = cat === "All" || p.category === cat;
    return matchesQuery && matchesCat;
  });

  statsLabel.textContent = `Showing ${filtered.length} of ${state.extractors.length} extractors`;

  // Render top results smoothly
  const displayItems = filtered.slice(0, 100);

  grid.innerHTML = displayItems.map(p => `
    <div class="plugin-item-card ${state.wizard.selectedSource?.name === p.name ? 'selected' : ''}" onclick="selectSourcePlugin('${p.name}')">
      <div class="plugin-card-header">
        <img src="${p.logo_url}" class="plugin-card-logo" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\'><rect fill=\\'%23f97316\\' width=\\'24\\' height=\\'24\\' rx=\\'4\\'/><text x=\\'12\\' y=\\'16\\' font-size=\\'12\\' fill=\\'white\\' text-anchor=\\'middle\\' font-weight=\\'bold\\'>T</text></svg>'">
        <div>
          <div class="plugin-card-title">${p.label}</div>
          <div class="plugin-card-category">${p.category || 'Connector'}</div>
        </div>
      </div>
      <div class="plugin-card-desc">${p.description}</div>
      <div style="margin-top: auto; display: flex; justify-content: space-between; align-items: center;">
        <span class="badge badge-neutral" style="font-size: 10px;">${p.name}</span>
        ${state.wizard.selectedSource?.name === p.name ? '<span class="badge badge-success">Selected</span>' : ''}
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
  const statsLabel = document.getElementById("targetStatsLabel");
  const query = (state.wizard.targetQuery || "").toLowerCase().trim();
  const cat = state.wizard.targetCategory;

  let filtered = state.loaders.filter(p => {
    const matchesQuery = !query || p.name.toLowerCase().includes(query) || p.label.toLowerCase().includes(query);
    const matchesCat = cat === "All" || p.category === cat;
    return matchesQuery && matchesCat;
  });

  statsLabel.textContent = `Showing ${filtered.length} of ${state.loaders.length} destinations`;

  grid.innerHTML = filtered.map(p => `
    <div class="plugin-item-card ${state.wizard.selectedTarget?.name === p.name ? 'selected' : ''}" onclick="selectTargetPlugin('${p.name}')">
      <div class="plugin-card-header">
        <img src="${p.logo_url}" class="plugin-card-logo" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\'><rect fill=\\'%2338bdf8\\' width=\\'24\\' height=\\'24\\' rx=\\'4\\'/><text x=\\'12\\' y=\\'16\\' font-size=\\'12\\' fill=\\'white\\' text-anchor=\\'middle\\' font-weight=\\'bold\\'>L</text></svg>'">
        <div>
          <div class="plugin-card-title">${p.label}</div>
          <div class="plugin-card-category">${p.category || 'Storage'}</div>
        </div>
      </div>
      <div class="plugin-card-desc">${p.description}</div>
      <div style="margin-top: auto; display: flex; justify-content: space-between; align-items: center;">
        <span class="badge badge-neutral" style="font-size: 10px;">${p.name}</span>
        ${state.wizard.selectedTarget?.name === p.name ? '<span class="badge badge-info">Selected</span>' : ''}
      </div>
    </div>
  `).join("");
}

function selectTargetPlugin(name) {
  state.wizard.selectedTarget = state.loaders.find(p => p.name === name);
  document.getElementById("btnWizardNext").disabled = false;
  renderTargetGrid();
}

// Step 3: Dynamic Form Generation
async function renderStep3Forms() {
  const src = state.wizard.selectedSource;
  const tgt = state.wizard.selectedTarget;

  document.getElementById("configStepTitle").textContent = `Configure ${src.label} ➔ ${tgt.label}`;
  document.getElementById("sourceConfigHeading").textContent = `${src.label} (Source)`;
  document.getElementById("targetConfigHeading").textContent = `${tgt.label} (Destination)`;

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
    container.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">No required settings for this connector.</div>`;
    return;
  }

  container.innerHTML = settings.map(s => {
    const isSecret = s.secret || s.kind === "password";
    const inputType = isSecret ? "password" : (s.kind === "integer" ? "number" : "text");
    const defaultValue = s.value !== undefined && s.value !== null ? s.value : "";
    const inputId = `${typePrefix}_${s.name.replace(/\./g, '_')}`;

    if (s.kind === "options" && s.options) {
      return `
        <div class="form-group">
          <div class="form-label-row">
            <label class="form-label" for="${inputId}">${s.label}</label>
          </div>
          <select class="form-input form-field" id="${inputId}" data-name="${s.name}" data-secret="${isSecret}" data-type="${typePrefix}">
            ${s.options.map(opt => `<option value="${opt}" ${opt === defaultValue ? 'selected' : ''}>${opt}</option>`).join("")}
          </select>
          ${s.description ? `<div class="form-hint">${s.description}</div>` : ''}
        </div>
      `;
    }

    return `
      <div class="form-group ${s.kind === 'string' && s.description?.length > 100 ? 'form-group-full' : ''}">
        <div class="form-label-row">
          <label class="form-label" for="${inputId}">${s.label}</label>
          ${isSecret ? '<span class="secret-badge">🔒 Stored in .env</span>' : ''}
        </div>
        <input 
          type="${inputType}" 
          class="form-input form-field" 
          id="${inputId}" 
          data-name="${s.name}" 
          data-secret="${isSecret}"
          data-type="${typePrefix}"
          placeholder="${s.placeholder || ''}" 
          value="${defaultValue}"
        >
        ${s.description ? `<div class="form-hint">${s.description}</div>` : ''}
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
  const alert = document.getElementById("connectionTestAlert");
  alert.style.display = "block";
  alert.style.backgroundColor = "var(--bg-surface-elevated)";
  alert.style.color = "var(--text-secondary)";
  alert.textContent = "Testing connection to database/service...";

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
      alert.style.backgroundColor = "var(--status-success-bg)";
      alert.style.color = "var(--status-success)";
      alert.textContent = `✓ ${res.message}`;
    } else {
      alert.style.backgroundColor = "var(--status-warning-bg)";
      alert.style.color = "var(--status-warning)";
      alert.textContent = `Notice: ${res.message}`;
    }
  } catch (err) {
    alert.style.backgroundColor = "var(--status-error-bg)";
    alert.style.color = "var(--status-error)";
    alert.textContent = `Test Error: ${err.message}`;
  }
}

// Step 4: Stream / Table Selection Matrix
async function renderStep4Streams() {
  document.getElementById("selectedSourceLabel").textContent = state.wizard.selectedSource.label;
  document.getElementById("selectedTargetLabel").textContent = state.wizard.selectedTarget.label;
  await loadDiscoveredStreams();
}

async function loadDiscoveredStreams() {
  const container = document.getElementById("streamsList");
  container.innerHTML = `<div style="padding: 16px; color: var(--text-muted);">Discovering tables & schema catalog...</div>`;

  try {
    const resp = await API.discoverStreams(state.wizard.selectedSource.name);
    state.wizard.streams = resp.streams || [];
    document.getElementById("streamsCountBadge").textContent = `${state.wizard.streams.length} streams discovered`;

    container.innerHTML = state.wizard.streams.map((s, idx) => `
      <div class="stream-row">
        <label class="stream-label-area">
          <input type="checkbox" class="stream-checkbox" data-stream="${s.name}" ${s.selected ? 'checked' : ''}>
          <div>
            <strong style="font-size: 13px; color: var(--text-primary);">${s.name}</strong>
            <span style="font-size: 11px; color: var(--text-muted); margin-left: 6px;">(${s.properties?.length || 0} fields)</span>
          </div>
        </label>
        <div class="stream-props-chips">
          ${(s.properties || []).slice(0, 4).map(p => `<span class="prop-chip">${p.name}</span>`).join("")}
          ${(s.properties?.length || 0) > 4 ? `<span class="prop-chip">+${s.properties.length - 4} more</span>` : ''}
        </div>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<div style="padding: 16px; color: var(--status-error);">Error discovering streams: ${err.message}</div>`;
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
      await API.gitCommit(`Add pipeline ${src.name} to ${tgt.name} with ${selectedStreams.length} streams`);
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
// 3. YAML INSPECTOR VIEW
// ==========================================
async function renderYamlView() {
  const pre = document.getElementById("rawYamlDisplay");
  pre.textContent = "Loading meltano.yml...";

  try {
    const data = await API.getProject();
    pre.textContent = data.raw_yaml || "# meltano.yml is not yet initialized";
    document.getElementById("secretsCountBadge").textContent = `${data.secrets_keys?.length || 0} secrets in .env`;

    document.getElementById("btnCopyYaml").onclick = () => {
      navigator.clipboard.writeText(data.raw_yaml || "");
      alert("meltano.yml copied to clipboard!");
    };

    document.getElementById("btnSaveYaml").onclick = () => openCommitModal();
    document.getElementById("btnRevertYaml").onclick = async () => {
      if (confirm("Are you sure you want to revert uncommitted changes in meltano.yml?")) {
        await API.gitRevert();
        await refreshAppState();
        renderYamlView();
      }
    };
  } catch (err) {
    pre.textContent = "Error loading YAML: " + err.message;
  }
}

// ==========================================
// 4. EXECUTION HISTORY VIEW
// ==========================================
async function renderHistoryView() {
  const container = document.getElementById("runsHistoryList");
  container.innerHTML = `<div style="color: var(--text-muted); padding: 16px;">Loading run history...</div>`;

  try {
    const resp = await API.listRuns();
    const runs = resp.runs || [];

    if (runs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-state-title">No Runs Recorded</h3>
          <p class="empty-state-desc">Trigger a pipeline to see live logs and run telemetry here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = runs.map(r => {
      const statusBadge = r.status === "SUCCESS" ? "badge-success" : (r.status === "RUNNING" ? "badge-warning" : "badge-neutral");
      return `
        <div class="pipeline-card">
          <div>
            <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${r.pipeline_name}</div>
            <div style="font-size: 12px; color: var(--text-muted); font-family: monospace;">${r.command}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Started: ${r.start_time} | Duration: ${r.duration_seconds}s</div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <span class="badge ${statusBadge}">${r.status}</span>
            <button class="btn btn-secondary btn-sm" onclick="openTerminalForRun('${r.run_id}', '${r.pipeline_name}')">
              View Logs
            </button>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div style="color: var(--status-error);">Error: ${err.message}</div>`;
  }
}

// ==========================================
// 5. LIVE TERMINAL / LOG DRAWER
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
  title.textContent = `Running ${extractor} ➔ ${loader}`;
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
      statusDot.style.backgroundColor = finalStatus === "SUCCESS" ? "var(--status-success)" : "var(--status-error)";
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
  logsBody.innerHTML = `<div style="color: var(--text-muted);">Fetching logs for run ${runId}...</div>`;
  title.textContent = pipelineName;

  API.getRunDetails(runId).then(details => {
    logsBody.innerHTML = "";
    (details.logs || []).forEach(l => appendTerminalLog(l));
  });
}

function appendTerminalLog(log) {
  const logsBody = document.getElementById("terminalLogsBody");
  const streamClass = `log-stream-${log.stream || 'stdout'}`;
  const row = document.createElement("div");
  row.className = "log-line";
  row.innerHTML = `
    <span class="log-time">[${log.timestamp || '--:--:--'}]</span>
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
// 6. GIT OPS MODAL CONTROLS
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
    const msg = document.getElementById("commitMessageInput").value.trim() || "Update Meltano configuration";
    try {
      const res = await API.gitCommit(msg);
      modal.style.display = "none";
      alert(res.message || "Committed to Git!");
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
