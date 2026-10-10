// AuraFilm Client Application

let currentLang = "en";
let i18nStrings = {};
let currentStatus = null;
let currentDomain = "";
let selectedWizardLang = "en";
let sseSource = null;

// Initialize
document.addEventListener("DOMContentLoaded", async () => {
  await loadStatus();
  await loadI18n(currentStatus?.language || "en");
  initSSE();

  if (!currentStatus?.setup_done) {
    showWizard();
  } else {
    loadHome();
  }
});

// SSE for real-time updates
function initSSE() {
  if (sseSource) sseSource.close();
  sseSource = new EventSource("/api/events");
  sseSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      handleSSEEvent(data);
    } catch (_) {}
  };
}

function handleSSEEvent(ev) {
  if (ev.type === "job_created" || ev.type === "job_updated" || ev.type === "job_removed" || ev.type === "jobs_cleared") {
    if (document.getElementById("viewDownloads").classList.contains("active")) {
      loadDownloads();
    }
    updateDownloadBadge();
  } else if (ev.type === "domain_changed") {
    currentDomain = ev.new;
    updateDomainUI();
  } else if (ev.type === "domain_search") {
    if (ev.state === "finished" && ev.best) {
      currentDomain = ev.best.host;
      updateDomainUI();
      if (document.getElementById("wizardModal").style.display !== "none") {
        document.getElementById("wizardStatusText").innerText = `${i18n("domain_found")} ${ev.best.host}`;
        document.getElementById("wizardManualDomain").value = ev.best.host;
      }
    }
  }
}

// System Status & i18n
async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    currentStatus = await res.json();
    currentDomain = currentStatus.domain || "";
    currentLang = currentStatus.language || "en";
    document.getElementById("langSelect").value = currentLang;
    updateDomainUI();
    updateDownloadBadge();
  } catch (err) {
    console.error("Status load failed", err);
  }
}

function updateDomainUI() {
  const pill = document.getElementById("domainPill");
  const txt = document.getElementById("domainText");
  const dot = pill.querySelector(".status-dot");
  if (currentDomain) {
    txt.innerText = currentDomain;
    dot.classList.remove("offline");
  } else {
    txt.innerText = i18n("status_offline") || "Offline";
    dot.classList.add("offline");
  }
  const input = document.getElementById("settingDomainInput");
  if (input) input.value = currentDomain;
}

async function loadI18n(lang) {
  try {
    currentLang = lang;
    const res = await fetch(`/api/i18n/${lang}`);
    i18nStrings = await res.json();
    applyI18n();
  } catch (err) {
    console.error("i18n load failed", err);
  }
}

function i18n(key) {
  return i18nStrings[key] || key;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (i18nStrings[key]) {
      el.innerText = i18nStrings[key];
    }
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (i18nStrings[key]) {
      el.placeholder = i18nStrings[key];
    }
  });
}

async function changeLanguage(lang) {
  await loadI18n(lang);
  await fetch("/api/settings", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({language: lang})
  });
}

// Navigation
function navigate(tab) {
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  document.querySelectorAll(".view-section").forEach(s => s.classList.remove("active"));
  
  const targetLink = document.querySelector(`.nav-link[data-tab="${tab}"]`);
  if (targetLink) targetLink.classList.add("active");

  const targetView = document.getElementById(`view${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
  if (targetView) targetView.classList.add("active");

  if (tab === "home") loadHome();
  if (tab === "downloads") loadDownloads();
  if (tab === "files") loadFiles();
  if (tab === "settings") loadSettings();
}

// Home Shelves
async function loadHome() {
  const container = document.getElementById("homeShelves");
  container.innerHTML = '<div class="loader-box">Loading shelves...</div>';
  try {
    const res = await fetch("/api/shelves");
    const data = await res.json();
    if (!data.shelves || data.shelves.length === 0) {
      container.innerHTML = `<div class="empty-state">${data.error || "No content found. Ensure the source domain is active."}</div>`;
      return;
    }
    container.innerHTML = "";
    data.shelves.forEach(shelf => {
      const shelfEl = document.createElement("div");
      shelfEl.className = "shelf";
      shelfEl.innerHTML = `
        <h3 class="shelf-title">${shelf.label || shelf.key}</h3>
        <div class="shelf-slider">
          ${shelf.items.map(renderMediaCard).join("")}
        </div>
      `;
      container.appendChild(shelfEl);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error loading content: ${err.message}</div>`;
  }
}

function renderMediaCard(item) {
  const posterUrl = item.poster ? `/api/image/${item.poster}` : "";
  return `
    <div class="media-card" onclick="openTitleModal(${item.id}, '${item.slug}')">
      <div class="media-poster-wrap">
        ${posterUrl ? `<img class="media-poster" src="${posterUrl}" loading="lazy" alt="${item.name}">` : '<div class="no-poster">🎬</div>'}
        ${item.score ? `<span class="media-badge">★ ${item.score}</span>` : ""}
      </div>
      <div class="media-info">
        <div class="media-name" title="${item.name}">${item.name}</div>
        <div class="media-meta">${item.year || ""} • ${item.type === "tv" ? (i18n("seasons") || "Series") : (i18n("download_movie") || "Movie")}</div>
      </div>
    </div>
  `;
}

// Search
async function doSearch() {
  const q = document.getElementById("navSearchInput").value.trim();
  if (!q) return;
  navigate("search");
  document.getElementById("searchQueryTitle").innerText = `${i18n("search_btn")}: "${q}"`;
  const grid = document.getElementById("searchResultsGrid");
  grid.innerHTML = '<div class="loader-box">Searching...</div>';
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      grid.innerHTML = '<div class="empty-state">No results found.</div>';
      return;
    }
    grid.innerHTML = data.results.map(renderMediaCard).join("");
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Search error: ${err.message}</div>`;
  }
}

// Title Details & Download Modal
async function openTitleModal(titleId, slug) {
  const modal = document.getElementById("titleModal");
  const content = document.getElementById("modalContent");
  modal.style.display = "flex";
  content.innerHTML = '<div class="p-4 loader-box">Loading details...</div>';

  try {
    const res = await fetch(`/api/title/${titleId}/${slug}`);
    const data = await res.json();
    const t = data.title;

    const bannerUrl = t.backdrop ? `/api/image/${t.backdrop}` : "";
    const posterUrl = t.poster ? `/api/image/${t.poster}` : "";

    let actionsHtml = "";
    if (t.type === "movie") {
      actionsHtml = `
        <div class="mt-4">
          <h4>${i18n("audio_tracks") || "Audio"}</h4>
          <div class="audio-options mt-2">
            <label><input type="checkbox" id="chkAudioIta" value="ita" checked> Italiano</label>
            <label class="ml-3"><input type="checkbox" id="chkAudioEng" value="eng"> English</label>
          </div>
          <button class="btn btn-primary btn-lg mt-3" onclick="startMovieDownload(${t.id}, '${t.slug}', '${escapeQuotes(t.name)}', '${t.year || ""}')">
            ⬇️ ${i18n("download_movie") || "Download Movie"}
          </button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="mt-4">
          <h4>${i18n("seasons") || "Seasons"}</h4>
          <div class="input-inline mt-2">
            <select id="seasonSelect" onchange="loadSeasonEpisodes(${t.id}, '${t.slug}', this.value, '${escapeQuotes(t.name)}', '${t.year || ""}')">
              ${(t.seasons || []).map(s => `<option value="${s.number}">${i18n("seasons") || "Season"} ${s.number} (${s.episodes_count} eps)</option>`).join("")}
            </select>
          </div>
          <div id="seasonEpisodesList" class="episodes-list mt-3"></div>
        </div>
      `;
    }

    content.innerHTML = `
      ${bannerUrl ? `<div class="detail-banner" style="background-image: url('${bannerUrl}')"></div>` : ""}
      <div class="detail-body">
        <div class="detail-poster-col">
          ${posterUrl ? `<img class="detail-poster" src="${posterUrl}">` : ""}
        </div>
        <div class="detail-content-col">
          <h2 class="detail-title">${t.name}</h2>
          <div class="detail-meta-row">
            ${t.year ? `<span>${t.year}</span>` : ""}
            ${t.quality ? `<span class="badge">${t.quality}</span>` : ""}
            ${t.score ? `<span>★ ${t.score}</span>` : ""}
            ${t.runtime ? `<span>${t.runtime} min</span>` : ""}
          </div>
          <p class="detail-plot">${t.plot || "No synopsis available."}</p>
          ${actionsHtml}
        </div>
      </div>
    `;

    if (t.type !== "movie" && t.seasons && t.seasons.length > 0) {
      loadSeasonEpisodes(t.id, t.slug, t.seasons[0].number, escapeQuotes(t.name), t.year || "");
    }
  } catch (err) {
    content.innerHTML = `<div class="p-4 empty-state">Failed to load title: ${err.message}</div>`;
  }
}

async function loadSeasonEpisodes(tvId, slug, seasonNum, tvName, year) {
  const container = document.getElementById("seasonEpisodesList");
  container.innerHTML = '<div class="loader-box">Loading episodes...</div>';
  try {
    const res = await fetch(`/api/title/${tvId}/${slug}/season/${seasonNum}`);
    const data = await res.json();
    const eps = data.episodes || [];
    
    container.innerHTML = `
      <div class="season-actions mb-3">
        <button class="btn btn-secondary btn-sm" onclick='downloadWholeSeason(${tvId}, "${slug}", "${tvName}", ${seasonNum}, ${JSON.stringify(eps).replace(/'/g, "&apos;")}, "${year}")'>
          ⬇️ ${i18n("download_season") || "Download Entire Season"} (${eps.length} eps)
        </button>
      </div>
      <div class="episodes-grid" style="display:flex; flex-direction:column; gap:8px;">
        ${eps.map(ep => `
          <div class="episode-row" style="background:var(--bg-card); padding:10px 14px; border-radius:var(--radius); display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>E${ep.number}</strong> ${ep.name || `Episode ${ep.number}`}
              ${ep.duration ? `<span class="text-muted ml-2">(${ep.duration}m)</span>` : ""}
            </div>
            <button class="btn btn-primary btn-sm" onclick='startEpisodeDownload(${tvId}, "${slug}", "${tvName}", ${seasonNum}, ${ep.id}, ${ep.number}, "${escapeQuotes(ep.name || "")}", "${year}")'>
              ⬇️ ${i18n("download_ep") || "Download"}
            </button>
          </div>
        `).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load season: ${err.message}</div>`;
  }
}

function escapeQuotes(str) {
  return (str || "").replace(/"/g, '\\"').replace(/'/g, "\\'");
}

function closeModal() {
  document.getElementById("titleModal").style.display = "none";
}

// Download Actions
async function startMovieDownload(titleId, slug, name, year) {
  const audios = [];
  if (document.getElementById("chkAudioIta")?.checked) audios.push("ita");
  if (document.getElementById("chkAudioEng")?.checked) audios.push("eng");
  if (audios.length === 0) audios.push("ita");

  await fetch("/api/jobs/movie", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      title_id: titleId,
      slug: slug,
      title_name: name,
      year: year || null,
      audio_languages: audios,
      subtitle_languages: []
    })
  });
  closeModal();
  navigate("downloads");
}

async function startEpisodeDownload(tvId, slug, tvName, season, episodeId, episodeNum, epName, year) {
  await fetch("/api/jobs/episode", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      tv_id: tvId,
      slug: slug,
      tv_name: tvName,
      season: season,
      episode_id: episodeId,
      episode_number: episodeNum,
      episode_name: epName,
      year: year || null,
      audio_languages: ["ita"],
      subtitle_languages: []
    })
  });
  closeModal();
  navigate("downloads");
}

async function downloadWholeSeason(tvId, slug, tvName, season, episodes, year) {
  await fetch("/api/jobs/season", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      tv_id: tvId,
      slug: slug,
      tv_name: tvName,
      season: season,
      episodes: episodes,
      year: year || null,
      audio_languages: ["ita"],
      subtitle_languages: []
    })
  });
  closeModal();
  navigate("downloads");
}

// Downloads View
async function loadDownloads() {
  const container = document.getElementById("downloadsList");
  try {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    const jobs = data.jobs || [];
    if (jobs.length === 0) {
      container.innerHTML = `<div class="empty-state">${i18n("queue_empty")}</div>`;
      return;
    }
    container.innerHTML = jobs.map(j => {
      const isRunning = j.status === "running";
      const speedMb = (j.speed / (1024 * 1024)).toFixed(1);
      return `
        <div class="download-card">
          <div class="dl-header">
            <div class="dl-title">${j.title_name} ${j.season ? `S${String(j.season).padStart(2,'0')}E${String(j.episode_number).padStart(2,'0')}` : ""}</div>
            <span class="dl-status-tag ${j.status}">${i18n(j.status) || j.status}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${j.percent}%"></div>
          </div>
          <div class="dl-footer">
            <div>
              ${isRunning ? `<span>${j.phase} • ${j.percent}% • ${speedMb} MB/s • ETA: ${j.eta}s</span>` : `<span>${j.error || j.status}</span>`}
            </div>
            <div>
              ${isRunning || j.status === "queued" ? `<button class="btn btn-danger btn-sm" onclick="cancelJob('${j.id}')">${i18n("cancel")}</button>` : ""}
            </div>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
  }
}

async function cancelJob(id) {
  await fetch(`/api/jobs/${id}/cancel`, {method: "POST"});
  loadDownloads();
}

async function clearCompletedJobs() {
  await fetch("/api/jobs/clear", {method: "POST"});
  loadDownloads();
}

async function updateDownloadBadge() {
  try {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    const active = (data.jobs || []).filter(j => j.status === "running" || j.status === "queued").length;
    const badge = document.getElementById("downloadBadge");
    if (active > 0) {
      badge.style.display = "inline-block";
      badge.innerText = active;
    } else {
      badge.style.display = "none";
    }
  } catch (_) {}
}

// Files View
async function loadFiles() {
  const container = document.getElementById("filesList");
  container.innerHTML = '<div class="loader-box">Scanning files...</div>';
  try {
    const res = await fetch("/api/files");
    const data = await res.json();
    const files = data.files || [];
    if (files.length === 0) {
      container.innerHTML = '<div class="empty-state">No files in downloads folder.</div>';
      return;
    }
    container.innerHTML = `
      <div class="text-muted mb-3">Total files: ${files.length} (${data.total_size_mb} MB)</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${files.map(f => `
          <div style="background:var(--bg-card); padding:12px 16px; border-radius:var(--radius); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>${f.name}</strong>
              <div class="text-muted" style="font-size:12px;">${f.path}</div>
            </div>
            <div>
              <span class="badge">${f.size_mb} MB</span>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
  }
}

// Settings View
async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const cfg = await res.json();
    document.getElementById("settingDomainInput").value = cfg.domain || "";
    document.getElementById("settingAutoApply").checked = cfg.domain_auto_apply !== false;
    document.getElementById("settingDownloadDir").value = cfg.download_dir || "";
    document.getElementById("settingFormat").value = cfg.output_format || "mkv";
    document.getElementById("settingWorkers").value = cfg.max_segment_workers || 12;
  } catch (err) {
    console.error("Settings load failed", err);
  }
}

async function saveManualDomain() {
  const dom = document.getElementById("settingDomainInput").value.trim();
  if (!dom) return;
  try {
    const res = await fetch("/api/domain/set", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({domain: dom})
    });
    const data = await res.json();
    if (data.status === "ok") {
      currentDomain = data.domain;
      updateDomainUI();
      alert("Domain updated successfully!");
    } else {
      alert("Error: " + data.detail);
    }
  } catch (err) {
    alert("Failed: " + err.message);
  }
}

async function triggerDomainCheck(force = true) {
  const box = document.getElementById("domainReportBox");
  box.style.display = "block";
  box.innerHTML = '<span class="spinner"></span> Checking and discovering active domains...';
  try {
    await fetch(`/api/domain/check?force=${force}`, {method: "POST"});
  } catch (err) {
    box.innerHTML = "Error: " + err.message;
  }
}

async function saveGeneralSettings() {
  const payload = {
    domain_auto_apply: document.getElementById("settingAutoApply").checked,
    download_dir: document.getElementById("settingDownloadDir").value,
    output_format: document.getElementById("settingFormat").value,
    max_segment_workers: parseInt(document.getElementById("settingWorkers").value, 10) || 12,
  };
  await fetch("/api/settings", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });
  alert("Settings saved!");
}

// Wizard
function showWizard() {
  const modal = document.getElementById("wizardModal");
  modal.style.display = "flex";
  
  const grid = document.getElementById("wizardLangGrid");
  const languages = [
    {code: "en", name: "English"},
    {code: "it", name: "Italiano"},
    {code: "es", name: "Español"},
    {code: "fr", name: "Français"},
    {code: "de", name: "Deutsch"},
    {code: "pt", name: "Português"},
  ];
  
  grid.innerHTML = languages.map(l => `
    <div class="lang-btn ${l.code === currentLang ? 'selected' : ''}" onclick="selectWizardLang('${l.code}', this)">
      ${l.name}
    </div>
  `).join("");

  // Start background domain discovery
  triggerDomainCheck(true);
}

function selectWizardLang(code, btn) {
  selectedWizardLang = code;
  document.querySelectorAll(".lang-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  loadI18n(code);
}

async function finishWizard() {
  const manual = document.getElementById("wizardManualDomain").value.trim();
  const domainToSet = manual || currentDomain;
  await fetch("/api/setup", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      language: selectedWizardLang,
      domain: domainToSet || null
    })
  });
  document.getElementById("wizardModal").style.display = "none";
  loadHome();
}
