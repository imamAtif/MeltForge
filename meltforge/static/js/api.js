/**
 * MeltForge API Client - Wrapper for REST endpoints and live WebSocket log streaming.
 */

const API = {
  async _request(path, options = {}) {
    try {
      const resp = await fetch(path, {
        headers: { "Content-Type": "application/json", ...options.headers },
        ...options,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `Request failed with status ${resp.status}`);
      }
      return await resp.json();
    } catch (e) {
      console.error(`API Error on ${path}:`, e);
      throw e;
    }
  },

  // Project APIs
  getProject: () => API._request("/api/project"),
  initProject: (projectName) => API._request("/api/project/init", {
    method: "POST",
    body: JSON.stringify({ project_name: projectName })
  }),
  savePlugin: (pluginData) => API._request("/api/project/plugin", {
    method: "POST",
    body: JSON.stringify(pluginData)
  }),
  removePlugin: (pluginType, name) => API._request(`/api/project/plugin/${pluginType}/${name}`, {
    method: "DELETE"
  }),

  // Hub & Sync APIs
  listPlugins: (type = "extractors", query = "") => 
    API._request(`/api/hub/plugins?type=${encodeURIComponent(type)}&query=${encodeURIComponent(query)}`),
  getPluginDetails: (type, name, variant = "") => 
    API._request(`/api/hub/plugins/${type}/${name}${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`),
  getCatalogStatus: () => API._request("/api/hub/status"),
  syncTaps: () => API._request("/api/hub/sync/taps", { method: "POST" }),
  syncTargets: () => API._request("/api/hub/sync/targets", { method: "POST" }),

  // Pipeline APIs
  listPipelines: () => API._request("/api/pipelines"),
  testConnection: (pluginType, pluginName) => API._request("/api/pipelines/test-connection", {
    method: "POST",
    body: JSON.stringify({ plugin_type: pluginType, plugin_name: pluginName })
  }),
  discoverStreams: (extractorName) => API._request("/api/pipelines/discover-streams", {
    method: "POST",
    body: JSON.stringify({ extractor_name: extractorName })
  }),
  runPipeline: (extractor, loader) => API._request("/api/pipelines/run", {
    method: "POST",
    body: JSON.stringify({ extractor, loader })
  }),
  listRuns: () => API._request("/api/pipelines/runs"),
  getRunDetails: (runId) => API._request(`/api/pipelines/runs/${runId}`),

  // Git APIs
  getGitStatus: () => API._request("/api/git/status"),
  gitCommit: (message) => API._request("/api/git/commit", {
    method: "POST",
    body: JSON.stringify({ message })
  }),
  gitRevert: () => API._request("/api/git/revert", { method: "POST" }),
  gitPull: () => API._request("/api/git/pull", { method: "POST" }),

  // WebSocket for Live Log Streaming
  connectRunWebSocket(runId, onMessage, onStatusChange) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/pipelines/ws/${runId}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessage) onMessage(data);
        if (data.complete && onStatusChange) {
          onStatusChange(data.status);
        }
      } catch (err) {
        console.error("Failed to parse log message:", err);
      }
    };

    ws.onerror = (err) => {
      console.warn("WebSocket error:", err);
    };

    return ws;
  }
};
