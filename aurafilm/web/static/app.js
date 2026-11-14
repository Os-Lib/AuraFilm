// AuraFilm Client Application

let currentLang = "en";
let i18nStrings = {};
let currentStatus = null;
let currentDomain = "";
let selectedWizardLang = "en";
let sseSource = null;

// Modal & Player state (kept in JS memory to avoid inline HTML/quote injection)
let activeModalItem = null;
let activeSeasonEpisodes = [];
let activeSeasonNum = 1;
let activePlayerMedia = null;
let historyCache = [];
let searchResultsCache = [];

// Search state
let currentSearchFilter = "all"; // "all" | "movie" | "tv" | "actor"
let lastSearchQuery = "";

// Genre explorer state
let selectedGenre = null;
let selectedGenreMediaType = null;

const GENRES_CONFIG = [
  { key: "Azione", it: "Azione", en: "Action" },
  { key: "Avventura", it: "Avventura", en: "Adventure" },
  { key: "Animazione", it: "Animazione", en: "Animation" },
  { key: "Commedia", it: "Commedia", en: "Comedy" },
  { key: "Crime", it: "Crime", en: "Crime" },
  { key: "Documentario", it: "Documentario", en: "Documentary" },
  { key: "Dramma", it: "Dramma", en: "Drama" },
  { key: "Famiglia", it: "Famiglia", en: "Family" },
  { key: "Fantasy", it: "Fantasy", en: "Fantasy" },
  { key: "Fantascienza", it: "Fantascienza", en: "Sci-Fi" },
  { key: "Horror", it: "Horror", en: "Horror" },
  { key: "Mistero", it: "Mistero", en: "Mystery" },
  { key: "Romantico", it: "Romantico", en: "Romance" },
  { key: "Thriller", it: "Thriller", en: "Thriller" },
  { key: "Western", it: "Western", en: "Western" },
  { key: "Guerra", it: "Guerra", en: "War" }
];

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeFileUrlPath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

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
    if (document.getElementById("viewDownloads")?.classList.contains("active")) {
      loadDownloads();
    }
    updateDownloadBadge();
  } else if (ev.type === "domain_changed") {
    currentDomain = ev.new;
    updateDomainUI();
  } else if (ev.type === "domain_search") {
    if (ev.state === "finished") {
      if (ev.best) {
        currentDomain = ev.best.host;
        updateDomainUI();
        if (document.getElementById("wizardModal").style.display !== "none") {
          document.getElementById("wizardStatusText").innerText = `${i18n("domain_found")} ${ev.best.host}`;
          document.getElementById("wizardManualDomain").value = ev.best.host;
        }
      }
      if (document.getElementById("viewSettings")?.classList.contains("active")) {
        refreshDomainStatusBox();
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
  initGenres();
  if (selectedGenre) {
    loadGenreResults();
  }
  const activeTab = document.querySelector(".nav-link.active")?.getAttribute("data-tab");
  if (activeTab === "home") loadHome();
  else if (activeTab === "downloads") loadDownloads();
  else if (activeTab === "files") loadFiles();
  else if (activeTab === "watchlist") loadWatchlist();
  else if (activeTab === "calendar") loadCalendar();
  else if (activeTab === "stats") loadStats();
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
  if (tab === "search") {
    const inp = document.getElementById("navSearchInput");
    if (inp && !inp.value.trim()) inp.focus();
  }
  if (tab === "downloads") loadDownloads();
  if (tab === "files") loadFiles();
  if (tab === "watchlist") loadWatchlist();
  if (tab === "calendar") loadCalendar();
  if (tab === "stats") loadStats();
  if (tab === "settings") loadSettings();
}

// Home Shelves & Hero Banner
async function loadHome() {
  loadContinueWatching();
  initGenres();
  const container = document.getElementById("homeShelves");
  container.innerHTML = `<div class="loader-box">${escapeHtml(i18n("loading_details"))}</div>`;
  try {
    const res = await fetch("/api/shelves");
    const data = await res.json();
    if (!data.shelves || data.shelves.length === 0) {
      document.getElementById("homeHero").style.display = "none";
      container.innerHTML = `<div class="empty-state">${escapeHtml(data.error || "No content found. Ensure the source domain is active.")}</div>`;
      return;
    }

    // Populate Hero Banner from first featured item
    const firstShelfItems = data.shelves[0]?.items || [];
    const heroItem = firstShelfItems.find(it => it.cover || it.poster) || firstShelfItems[0];
    if (heroItem) {
      renderHeroBanner(heroItem);
    }

    container.innerHTML = "";
    data.shelves.forEach(shelf => {
      const shelfEl = document.createElement("div");
      shelfEl.className = "shelf";
      shelfEl.innerHTML = `
        <h3 class="shelf-title">${escapeHtml(shelf.label || shelf.key)}</h3>
        <div class="shelf-slider">
          ${shelf.items.map(renderMediaCard).join("")}
        </div>
      `;
      container.appendChild(shelfEl);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error loading content: ${escapeHtml(err.message)}</div>`;
  }
}

function renderHeroBanner(hero) {
  const heroBox = document.getElementById("homeHero");
  const bg = document.getElementById("heroBackdrop");
  const titleEl = document.getElementById("heroTitle");
  const metaEl = document.getElementById("heroMeta");
  const plotEl = document.getElementById("heroPlot");
  const btn = document.getElementById("heroWatchBtn");
  if (!heroBox || !bg || !titleEl || !metaEl || !plotEl || !btn) return;

  const art = hero.cover || hero.poster;
  bg.style.backgroundImage = art ? `url('/api/image/${art}')` : "none";
  titleEl.textContent = hero.name || "";

  const metaParts = [];
  if (hero.year) metaParts.push(hero.year);
  metaParts.push(hero.type === "tv" ? i18n("type_tv") : i18n("type_movie"));
  if (hero.score) metaParts.push(`${hero.score} / 10`);
  metaEl.textContent = metaParts.join("  |  ");
  plotEl.textContent = hero.plot || "";

  btn.onclick = () => openTitleModal(hero.id, hero.slug);
  heroBox.style.display = "flex";

  // Enrich hero plot asynchronously without blocking initial paint
  fetch(`/api/title/${hero.id}/${encodeURIComponent(hero.slug)}`)
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (d?.title?.plot && titleEl.textContent === hero.name) {
        plotEl.textContent = d.title.plot;
      }
    })
    .catch(() => {});
}

function renderMediaCard(item, idx = -1) {
  const artFile = item.poster || item.cover;
  const posterUrl = item.poster_url || (artFile ? `/api/image/${artFile}` : "");

  let metaLabel = "";
  if (item.type === "tv") {
    if (item.seasons_count && item.seasons_count > 0) {
      metaLabel = `${item.seasons_count} ${item.seasons_count === 1 ? i18n("season_singular") : i18n("seasons")}`;
    } else {
      metaLabel = i18n("type_tv");
    }
  } else {
    metaLabel = i18n("type_movie");
  }

  const safeName = escapeHtml(item.name);
  const metaLine = [item.year, metaLabel].filter(Boolean).join(" • ");

  if (item.tmdb_only) {
    return `
      <div class="media-card" data-name="${safeName}" onclick="searchTmdbTitle(this.dataset.name)">
        <div class="media-poster-wrap">
          ${posterUrl ? `<img class="media-poster" src="${escapeHtml(posterUrl)}" loading="lazy" alt="${safeName}">` : '<div class="no-poster">AuraFilm</div>'}
          ${item.score ? `<span class="media-badge">${escapeHtml(item.score)}</span>` : ""}
        </div>
        <div class="media-info">
          <div class="media-name" title="${safeName}">${safeName}</div>
          <div class="media-meta">${escapeHtml(metaLine)}</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="media-card" data-slug="${escapeHtml(item.slug || "")}" onclick="openTitleModal(${Number(item.id)}, this.dataset.slug)">
      <div class="media-poster-wrap">
        ${posterUrl ? `<img class="media-poster" src="${escapeHtml(posterUrl)}" loading="lazy" alt="${safeName}">` : '<div class="no-poster">AuraFilm</div>'}
        ${item.score ? `<span class="media-badge">${escapeHtml(item.score)}</span>` : ""}
      </div>
      <div class="media-info">
        <div class="media-name" title="${safeName}">${safeName}</div>
        <div class="media-meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>
  `;
}

// Search & Filters
function setSearchFilter(filter, el) {
  currentSearchFilter = filter;
  document.querySelectorAll(".search-type-filters button").forEach(b => b.classList.remove("active"));
  if (el) el.classList.add("active");
  const q = document.getElementById("navSearchInput")?.value.trim() || lastSearchQuery;
  if (q) {
    doSearch();
  }
}

function searchTmdbTitle(titleName) {
  const inp = document.getElementById("navSearchInput");
  if (inp) inp.value = titleName;
  currentSearchFilter = "all";
  document.querySelectorAll(".search-type-filters button").forEach(b => b.classList.remove("active"));
  const allBtn = document.getElementById("searchFilterAll");
  if (allBtn) allBtn.classList.add("active");
  doSearch();
}

async function doSearch() {
  const q = document.getElementById("navSearchInput").value.trim();
  if (!q) return;
  lastSearchQuery = q;
  navigate("search");

  const titleEl = document.getElementById("searchQueryTitle");
  const grid = document.getElementById("searchResultsGrid");
  titleEl.innerText = `${i18n("search_btn")}: "${q}"`;
  grid.innerHTML = `<div class="loader-box">${escapeHtml(i18n("searching"))}</div>`;

  try {
    let url = "";
    if (currentSearchFilter === "actor") {
      url = `/api/search/actor?q=${encodeURIComponent(q)}`;
    } else {
      url = `/api/search?q=${encodeURIComponent(q)}`;
      if (currentSearchFilter === "movie" || currentSearchFilter === "tv") {
        url += `&type=${currentSearchFilter}`;
      }
    }

    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      grid.innerHTML = `<div class="empty-state">${escapeHtml(data.detail || "Search failed.")}</div>`;
      return;
    }

    if (currentSearchFilter === "actor" && data.person) {
      titleEl.innerText = `${i18n("filter_actor")}: ${data.person}`;
    }

    const results = data.results || [];
    searchResultsCache = results;
    if (results.length === 0) {
      grid.innerHTML = `<div class="empty-state">${escapeHtml(i18n("search_empty"))}</div>`;
      return;
    }
    grid.innerHTML = results.map((it, idx) => renderMediaCard(it, idx)).join("");
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// Title Details & Download Modal
async function openTitleModal(titleId, slug) {
  const modal = document.getElementById("titleModal");
  const content = document.getElementById("modalContent");
  modal.style.display = "flex";
  content.innerHTML = `<div class="p-4 loader-box">${escapeHtml(i18n("loading_details"))}</div>`;

  try {
    const res = await fetch(`/api/title/${titleId}/${encodeURIComponent(slug || "")}`);
    const data = await res.json();
    if (!res.ok || !data.title) {
      throw new Error(data.detail || "Title not found");
    }
    const t = data.title;

    activeModalItem = {
      id: t.id,
      name: t.name,
      slug: t.slug,
      poster: t.poster || t.cover || "",
      type: t.type || "movie",
      year: t.year || ""
    };

    const bannerUrl = t.backdrop ? `/api/image/${t.backdrop}` : (t.cover ? `/api/image/${t.cover}` : "");
    const posterUrl = t.poster ? `/api/image/${t.poster}` : (t.cover ? `/api/image/${t.cover}` : "");

    let actionsHtml = "";
    if (t.type === "movie") {
      actionsHtml = `
        <div class="mt-4">
          <h4>${escapeHtml(i18n("audio_tracks"))}</h4>
          <div id="movieAudioOptions" class="audio-options mt-2">
            <label><input type="checkbox" name="dlAudio" value="ita" checked> Italiano</label>
            <label><input type="checkbox" name="dlAudio" value="eng"> English</label>
          </div>
          <div id="movieSubOptionsWrap" style="display:none; margin-top: 12px;">
            <h4>${escapeHtml(i18n("subtitles"))}</h4>
            <div id="movieSubOptions" class="audio-options mt-2"></div>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top: 15px;">
            <button class="btn btn-primary btn-lg" onclick="startMovieDownload()">
              ${escapeHtml(i18n("download_movie"))}
            </button>
            <button class="btn btn-secondary btn-lg" onclick="playActiveMovie()">
              ${escapeHtml(i18n("play_now"))}
            </button>
          </div>
        </div>
      `;
    } else {
      const seasonLabel = escapeHtml(i18n("season_singular"));
      actionsHtml = `
        <div class="mt-4">
          <h4>${escapeHtml(i18n("seasons"))}</h4>
          <div class="input-inline mt-2">
            <select id="seasonSelect" onchange="loadSeasonEpisodes(${t.id}, '${escapeHtml(t.slug)}', this.value)">
              ${(t.seasons || []).map(s => `<option value="${s.number}">${seasonLabel} ${s.number} (${s.episodes_count} eps)</option>`).join("")}
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
          ${posterUrl ? `<img class="detail-poster" src="${posterUrl}" alt="${escapeHtml(t.name)}">` : ""}
        </div>
        <div class="detail-content-col">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
            <h2 class="detail-title">${escapeHtml(t.name)}</h2>
            <button class="btn btn-secondary btn-sm" onclick="toggleWatchlistCurrent()" id="btnModalWatchlist">${escapeHtml(i18n("watchlist_add"))}</button>
          </div>
          <div class="detail-meta-row">
            ${t.year ? `<span>${escapeHtml(t.year)}</span>` : ""}
            ${t.quality ? `<span class="badge">${escapeHtml(t.quality)}</span>` : ""}
            ${t.score ? `<span>${escapeHtml(t.score)}</span>` : ""}
            ${t.runtime ? `<span>${escapeHtml(t.runtime)} min</span>` : ""}
          </div>
          <p class="detail-plot">${escapeHtml(t.plot || i18n("no_plot"))}</p>
          ${actionsHtml}
        </div>
      </div>
    `;

    // Sync Watchlist status
    fetch("/api/watchlist").then(r => r.json()).then(wData => {
      const isFav = (wData.watchlist || []).some(w => w.id === t.id);
      const btn = document.getElementById("btnModalWatchlist");
      if (btn && isFav) {
        btn.textContent = i18n("watchlist_added");
        btn.className = "btn btn-primary btn-sm";
      }
    }).catch(() => {});

    if (t.type === "movie") {
      probeTitleStreams(t.id, null);
    } else if (t.seasons && t.seasons.length > 0) {
      loadSeasonEpisodes(t.id, t.slug, t.seasons[0].number);
    }
  } catch (err) {
    content.innerHTML = `<div class="p-4 empty-state">Failed to load title: ${escapeHtml(err.message)}</div>`;
  }
}

async function probeTitleStreams(titleId, episodeId) {
  try {
    let url = `/api/title/${titleId}/probe`;
    if (episodeId) url += `?episode_id=${episodeId}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    const audioBox = document.getElementById("movieAudioOptions");
    if (audioBox && Array.isArray(data.audio) && data.audio.length > 0) {
      audioBox.innerHTML = data.audio.map((lang, idx) => `
        <label><input type="checkbox" name="dlAudio" value="${escapeHtml(lang)}" ${idx === 0 ? "checked" : ""}> ${escapeHtml(lang.toUpperCase())}</label>
      `).join("");
    }

    const subWrap = document.getElementById("movieSubOptionsWrap");
    const subBox = document.getElementById("movieSubOptions");
    if (subWrap && subBox && Array.isArray(data.subtitles) && data.subtitles.length > 0) {
      subWrap.style.display = "block";
      subBox.innerHTML = data.subtitles.map(lang => `
        <label><input type="checkbox" name="dlSub" value="${escapeHtml(lang)}"> ${escapeHtml(lang.toUpperCase())}</label>
      `).join("");
    }
  } catch (_) {}
}

async function loadSeasonEpisodes(tvId, slug, seasonNum) {
  const container = document.getElementById("seasonEpisodesList");
  if (!container) return;
  container.innerHTML = `<div class="loader-box">${escapeHtml(i18n("loading_episodes"))}</div>`;
  try {
    const res = await fetch(`/api/title/${tvId}/${encodeURIComponent(slug)}/season/${seasonNum}`);
    const data = await res.json();
    const eps = data.episodes || [];
    activeSeasonEpisodes = eps;
    activeSeasonNum = parseInt(seasonNum, 10) || 1;

    container.innerHTML = `
      <div class="season-actions mb-3">
        <button class="btn btn-secondary btn-sm" onclick="downloadWholeSeason()">
          ${escapeHtml(i18n("download_season"))} (${eps.length} ep)
        </button>
      </div>
      <div class="episodes-grid" style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
        ${eps.map((ep, idx) => `
          <div class="episode-row" style="background:var(--bg-card); padding:10px 14px; border-radius:var(--radius); display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div>
              <strong>E${escapeHtml(ep.number)}</strong> ${escapeHtml(ep.name || `Episodio ${ep.number}`)}
              ${ep.duration ? `<span class="text-muted" style="margin-left:8px;">(${escapeHtml(ep.duration)}m)</span>` : ""}
            </div>
            <div style="display:flex; gap:8px; flex-shrink:0;">
              <button class="btn btn-secondary btn-sm" onclick="playEpisodeByIndex(${idx})">
                ${escapeHtml(i18n("play_now"))}
              </button>
              <button class="btn btn-primary btn-sm" onclick="startEpisodeDownloadByIndex(${idx})">
                ${escapeHtml(i18n("downloads"))}
              </button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load season: ${escapeHtml(err.message)}</div>`;
  }
}

function closeModal() {
  document.getElementById("titleModal").style.display = "none";
}

function playActiveMovie() {
  if (!activeModalItem) return;
  const url = `/api/stream/proxy/${activeModalItem.id}/${encodeURIComponent(activeModalItem.slug)}`;
  openVideoPlayer(url, "hls", { ...activeModalItem }, 0);
}

function playEpisodeByIndex(idx) {
  const ep = activeSeasonEpisodes[idx];
  if (!activeModalItem || !ep) return;
  const url = `/api/stream/proxy/${activeModalItem.id}/${encodeURIComponent(activeModalItem.slug)}?episode_id=${ep.id}`;
  const meta = {
    ...activeModalItem,
    name: `${activeModalItem.name} S${String(activeSeasonNum).padStart(2, "0")}E${String(ep.number || idx + 1).padStart(2, "0")}`,
    episode_id: ep.id,
    season: activeSeasonNum,
    episode: ep.number,
  };
  openVideoPlayer(url, "hls", meta, 0);
}

// Download Actions
async function startMovieDownload() {
  if (!activeModalItem) return;
  const audios = Array.from(document.querySelectorAll('#movieAudioOptions input[name="dlAudio"]:checked')).map(i => i.value);
  if (audios.length === 0) audios.push("ita");
  const subs = Array.from(document.querySelectorAll('#movieSubOptions input[name="dlSub"]:checked')).map(i => i.value);

  await fetch("/api/jobs/movie", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      title_id: activeModalItem.id,
      slug: activeModalItem.slug,
      title_name: activeModalItem.name,
      year: activeModalItem.year || null,
      audio_languages: audios,
      subtitle_languages: subs
    })
  });
  closeModal();
  navigate("downloads");
}

async function startEpisodeDownloadByIndex(idx) {
  const ep = activeSeasonEpisodes[idx];
  if (!activeModalItem || !ep) return;
  await fetch("/api/jobs/episode", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      tv_id: activeModalItem.id,
      slug: activeModalItem.slug,
      tv_name: activeModalItem.name,
      season: activeSeasonNum,
      episode_id: ep.id,
      episode_number: ep.number,
      episode_name: ep.name || "",
      year: activeModalItem.year || null,
      audio_languages: [currentStatus?.preferred_audio || "ita"],
      subtitle_languages: []
    })
  });
  closeModal();
  navigate("downloads");
}

async function downloadWholeSeason() {
  if (!activeModalItem || activeSeasonEpisodes.length === 0) return;
  await fetch("/api/jobs/season", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      tv_id: activeModalItem.id,
      slug: activeModalItem.slug,
      tv_name: activeModalItem.name,
      season: activeSeasonNum,
      episodes: activeSeasonEpisodes,
      year: activeModalItem.year || null,
      audio_languages: [currentStatus?.preferred_audio || "ita"],
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
      container.innerHTML = `<div class="empty-state">${escapeHtml(i18n("queue_empty"))}</div>`;
      return;
    }
    container.innerHTML = jobs.map(j => {
      const isRunning = j.status === "running";
      const isQueued = j.status === "queued";
      const speedMb = ((j.speed || 0) / (1024 * 1024)).toFixed(1);
      const pct = Math.round((j.percent || 0) * 10) / 10;
      const etaTxt = j.eta != null ? ` • ETA: ${j.eta}s` : "";
      const footerInfo = isRunning
        ? `${escapeHtml(j.phase)} • ${pct}% • ${speedMb} MB/s${etaTxt}`
        : `${escapeHtml(j.error || i18n(j.status) || j.status)}`;

      return `
        <div class="download-card">
          <div class="dl-header">
            <div class="dl-title">${escapeHtml(j.title_name)} ${j.season ? `S${String(j.season).padStart(2, "0")}E${String(j.episode_number).padStart(2, "0")}` : ""}</div>
            <span class="dl-status-tag ${escapeHtml(j.status)}">${escapeHtml(i18n(j.status) || j.status)}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${pct}%"></div>
          </div>
          <div class="dl-footer">
            <div><span>${footerInfo}</span></div>
            <div style="display:flex; gap:6px;">
              ${(isRunning || isQueued)
                ? `<button class="btn btn-danger btn-sm" onclick="cancelJob('${escapeHtml(j.id)}')">${escapeHtml(i18n("cancel"))}</button>`
                : `<button class="btn btn-secondary btn-sm" onclick="deleteJob('${escapeHtml(j.id)}')">${escapeHtml(i18n("delete_btn"))}</button>`}
            </div>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

async function cancelJob(id) {
  await fetch(`/api/jobs/${id}/cancel`, {method: "POST"});
  loadDownloads();
  updateDownloadBadge();
}

async function deleteJob(id) {
  await fetch(`/api/jobs/${id}`, {method: "DELETE"});
  loadDownloads();
  updateDownloadBadge();
}

async function clearCompletedJobs() {
  await fetch("/api/jobs/clear", {method: "POST"});
  loadDownloads();
  updateDownloadBadge();
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
  container.innerHTML = `<div class="loader-box">${escapeHtml(i18n("loading_details"))}</div>`;
  try {
    const res = await fetch("/api/files");
    const data = await res.json();
    const files = data.files || [];
    if (files.length === 0) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(i18n("no_files"))}</div>`;
      return;
    }
    container.innerHTML = `
      <div class="text-muted mb-3">${escapeHtml(i18n("files_total"))}: ${files.length} (${data.total_size_mb} MB)</div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
        ${files.map(f => {
          const safePath = escapeHtml(f.path);
          return `
            <div style="background:var(--bg-card); padding:12px 16px; border-radius:var(--radius); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; gap:12px;">
              <div style="min-width:0;">
                <strong>${escapeHtml(f.name)}</strong>
                <div class="text-muted" style="font-size:12px; word-break:break-all;">${safePath}</div>
              </div>
              <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
                <span class="badge">${escapeHtml(f.size_mb)} MB</span>
                <button class="btn btn-secondary btn-sm" data-path="${safePath}" onclick="playLocalFile(this.dataset.path)">
                  ${escapeHtml(i18n("play_now"))}
                </button>
                <button class="btn btn-secondary btn-sm" style="color:#ef4444; border-color:#ef4444;" data-path="${safePath}" onclick="deleteLocalFile(this.dataset.path)">
                  ${escapeHtml(i18n("delete_btn"))}
                </button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function playLocalFile(filePath) {
  const url = `/api/files/download/${encodeFileUrlPath(filePath)}`;
  openVideoPlayer(url, "local", null, 0);
}

async function deleteLocalFile(filePath) {
  if (!confirm(i18n("confirm_delete_file"))) return;
  try {
    const res = await fetch(`/api/files/${encodeFileUrlPath(filePath)}`, { method: "DELETE" });
    if (res.ok) {
      loadFiles();
    }
  } catch (err) {
    alert("Error: " + err.message);
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

    if (document.getElementById("settingDefaultQuality")) {
      document.getElementById("settingDefaultQuality").value = cfg.default_quality || "1080p";
    }

    if (document.getElementById("settingTelegramToken")) {
      document.getElementById("settingTelegramToken").value = cfg.telegram_bot_token || "";
      document.getElementById("settingNightCompression").checked = !!cfg.night_compression_h265;
      document.getElementById("settingCompStart").value = cfg.compression_start_hour || 2;
      document.getElementById("settingCompEnd").value = cfg.compression_end_hour || 6;
      if (document.getElementById("settingRcloneEnabled")) {
        document.getElementById("settingRcloneEnabled").checked = !!cfg.rclone_enabled;
        document.getElementById("settingRcloneRemote").value = cfg.rclone_remote || "gdrive:/AuraFilm";
        document.getElementById("settingRcloneDelete").checked = !!cfg.rclone_delete_after_upload;
      }
      if (document.getElementById("settingDiscordWebhook")) {
        document.getElementById("settingDiscordWebhook").value = cfg.discord_webhook_url || "";
      }
      if (document.getElementById("settingTmdbKey")) {
        document.getElementById("settingTmdbKey").value = cfg.tmdb_api_key || "";
      }
      if (document.getElementById("settingSpeedLimit")) {
        document.getElementById("settingSpeedLimit").value = cfg.download_speed_limit_mb || 0;
      }
      if (document.getElementById("settingPreferredAudio")) {
        document.getElementById("settingPreferredAudio").value = cfg.preferred_audio || "ita";
      }
    }
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
    if (res.ok && data.status === "ok") {
      currentDomain = data.domain;
      updateDomainUI();
      alert(i18n("settings_saved"));
    } else {
      alert("Error: " + (data.detail || "Invalid domain"));
    }
  } catch (err) {
    alert("Failed: " + err.message);
  }
}

async function triggerDomainCheck(force = true) {
  const box = document.getElementById("domainReportBox");
  if (box) {
    box.style.display = "block";
    box.innerHTML = `<span class="spinner"></span> ${escapeHtml(i18n("status_checking"))}`;
  }
  try {
    await fetch(`/api/domain/check?force=${force}`, {method: "POST"});
    setTimeout(refreshDomainStatusBox, 2500);
  } catch (err) {
    if (box) box.innerHTML = "Error: " + escapeHtml(err.message);
  }
}

async function refreshDomainStatusBox() {
  const box = document.getElementById("domainReportBox");
  if (!box) return;
  try {
    const res = await fetch("/api/domain/status");
    const st = await res.json();
    if (st.current) {
      currentDomain = st.current;
      updateDomainUI();
    }
    const report = st.last_report || {};
    const candidates = report.candidates || [];
    if (st.is_running) {
      setTimeout(refreshDomainStatusBox, 2000);
      return;
    }
    if (candidates.length > 0) {
      box.innerHTML = `<strong>${escapeHtml(i18n("current_domain"))}:</strong> ${escapeHtml(st.current || "-")}<br>` +
        candidates.slice(0, 5).map(c => `${escapeHtml(c.host)} (${escapeHtml(c.status)}${c.latency_ms ? `, ${c.latency_ms}ms` : ""})`).join(" | ");
    } else {
      box.innerHTML = `<strong>${escapeHtml(i18n("current_domain"))}:</strong> ${escapeHtml(st.current || i18n("status_offline"))}`;
    }
  } catch (_) {}
}

async function saveGeneralSettings() {
  const payload = {
    domain_auto_apply: document.getElementById("settingAutoApply").checked,
    download_dir: document.getElementById("settingDownloadDir").value,
    output_format: document.getElementById("settingFormat").value,
    max_segment_workers: parseInt(document.getElementById("settingWorkers").value, 10) || 12,
  };

  if (document.getElementById("settingDefaultQuality")) {
    payload.default_quality = document.getElementById("settingDefaultQuality").value;
    const qMap = { "4k": 2160, "1080p": 1080, "720p": 720 };
    if (qMap[payload.default_quality]) {
      payload.max_quality = qMap[payload.default_quality];
    }
  }

  const tgToken = document.getElementById("settingTelegramToken");
  if (tgToken) {
    payload.telegram_bot_token = tgToken.value.trim();
    payload.night_compression_h265 = document.getElementById("settingNightCompression").checked;
    payload.compression_start_hour = parseInt(document.getElementById("settingCompStart").value, 10) || 2;
    payload.compression_end_hour = parseInt(document.getElementById("settingCompEnd").value, 10) || 6;
    if (document.getElementById("settingRcloneEnabled")) {
      payload.rclone_enabled = document.getElementById("settingRcloneEnabled").checked;
      payload.rclone_remote = document.getElementById("settingRcloneRemote").value.trim();
      payload.rclone_delete_after_upload = document.getElementById("settingRcloneDelete").checked;
    }
    if (document.getElementById("settingDiscordWebhook")) {
      payload.discord_webhook_url = document.getElementById("settingDiscordWebhook").value.trim();
    }
    if (document.getElementById("settingTmdbKey")) {
      payload.tmdb_api_key = document.getElementById("settingTmdbKey").value.trim();
    }
    if (document.getElementById("settingSpeedLimit")) {
      payload.download_speed_limit_mb = parseInt(document.getElementById("settingSpeedLimit").value, 10) || 0;
    }
    if (document.getElementById("settingPreferredAudio")) {
      payload.preferred_audio = document.getElementById("settingPreferredAudio").value;
      if (currentStatus) currentStatus.preferred_audio = payload.preferred_audio;
    }
  }

  await fetch("/api/settings", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });
  alert(i18n("settings_saved"));
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

// Video Player & History Tracking
let hlsInstance = null;

function changeVideoQuality(idx) {
  if (hlsInstance) {
    hlsInstance.currentLevel = parseInt(idx, 10);
  }
}

function savePlayerProgress() {
  const video = document.getElementById("videoPlayer");
  if (!activePlayerMedia || !video || !video.duration || isNaN(video.duration)) return;
  fetch("/api/history", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      ...activePlayerMedia,
      current_time: video.currentTime,
      duration: video.duration
    })
  }).catch(() => {});
}

function openVideoPlayer(url, type, mediaMeta = null, startTime = 0) {
  const modal = document.getElementById("videoModal");
  const video = document.getElementById("videoPlayer");
  const qualitySelect = document.getElementById("videoQualitySelect");

  activePlayerMedia = (type === "local") ? null : mediaMeta;
  modal.style.display = "flex";

  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  let seekApplied = false;
  const applyStartTime = () => {
    if (!seekApplied && startTime > 5 && video.duration && startTime < video.duration - 10) {
      seekApplied = true;
      video.currentTime = startTime;
    }
  };
  video.onloadedmetadata = applyStartTime;

  if (type === "hls" && typeof Hls !== "undefined" && Hls.isSupported()) {
    qualitySelect.style.display = "inline-block";
    qualitySelect.innerHTML = `<option value="-1">${escapeHtml(i18n("quality_auto"))}</option>`;

    hlsInstance = new Hls({
      debug: false,
      enableWorker: true
    });
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(video);

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
      if (hlsInstance.levels && hlsInstance.levels.length > 0) {
        qualitySelect.innerHTML = `<option value="-1">${escapeHtml(i18n("quality_auto"))}</option>`;
        let highestIdx = 0;
        let maxHeight = 0;
        hlsInstance.levels.forEach((lvl, idx) => {
          const label = lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)}k`;
          const opt = document.createElement("option");
          opt.value = idx;
          opt.textContent = label;
          qualitySelect.appendChild(opt);
          if (lvl.height && lvl.height > maxHeight) {
            maxHeight = lvl.height;
            highestIdx = idx;
          }
        });
        hlsInstance.currentLevel = highestIdx;
        qualitySelect.value = highestIdx;
      }
      applyStartTime();
      video.play().catch(e => console.warn("Autoplay notice:", e));
    });

    hlsInstance.on(Hls.Events.ERROR, function(event, data) {
      console.error("Hls event error:", data);
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hlsInstance.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hlsInstance.recoverMediaError();
        } else {
          hlsInstance.destroy();
        }
      }
    });
  } else {
    if (qualitySelect) qualitySelect.style.display = "none";
    video.src = url;
    video.play().catch(e => console.warn("Autoplay notice:", e));
  }

  let lastReportTime = 0;
  video.ontimeupdate = () => {
    const now = Date.now();
    if (activePlayerMedia && video.duration > 0 && now - lastReportTime > 5000) {
      lastReportTime = now;
      savePlayerProgress();
    }
  };
  video.onpause = () => savePlayerProgress();
}

function closeVideoModal() {
  const modal = document.getElementById("videoModal");
  const video = document.getElementById("videoPlayer");
  savePlayerProgress();
  activePlayerMedia = null;
  modal.style.display = "none";
  video.pause();
  video.ontimeupdate = null;
  video.onpause = null;
  video.onloadedmetadata = null;
  video.removeAttribute("src");
  video.load();
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  loadContinueWatching();
}

// ── Genre Explorer ──────────────────────────────────────────────────────────

function getGenreLabel(gObj) {
  return currentLang === "it" ? gObj.it : gObj.en;
}

function initGenres() {
  const container = document.getElementById("genreChipsList");
  if (!container) return;
  container.innerHTML = "";
  GENRES_CONFIG.forEach(g => {
    const btn = document.createElement("button");
    btn.className = `btn btn-sm ${selectedGenre === g.key ? "btn-primary" : "btn-secondary"}`;
    btn.textContent = getGenreLabel(g);
    btn.onclick = () => toggleGenre(g.key);
    container.appendChild(btn);
  });
}

function setGenreTypeFilter(type, el) {
  selectedGenreMediaType = type;
  document.querySelectorAll(".genre-type-filters button").forEach(b => b.classList.remove("active"));
  if (el) el.classList.add("active");
  if (selectedGenre) {
    loadGenreResults();
  }
}

function closeGenreResults() {
  selectedGenre = null;
  initGenres();
  const container = document.getElementById("genreResultsContainer");
  if (container) container.style.display = "none";
}

function toggleGenre(genreKey) {
  if (selectedGenre === genreKey) {
    closeGenreResults();
    return;
  }
  selectedGenre = genreKey;
  initGenres();
  loadGenreResults();
}

async function loadGenreResults() {
  if (!selectedGenre) return;
  const container = document.getElementById("genreResultsContainer");
  const title = document.getElementById("genreResultsTitle");
  const grid = document.getElementById("genreResultsGrid");
  if (!container || !title || !grid) return;

  const gObj = GENRES_CONFIG.find(g => g.key === selectedGenre);
  const genreDisplay = gObj ? getGenreLabel(gObj) : selectedGenre;

  container.style.display = "block";
  const typeLabel = selectedGenreMediaType === "movie"
    ? i18n("filter_movies")
    : (selectedGenreMediaType === "tv" ? i18n("filter_series") : i18n("all_titles"));
  title.textContent = `${genreDisplay} (${typeLabel})`;
  grid.innerHTML = `<div class="loader-box">${escapeHtml(i18n("searching"))}</div>`;

  try {
    let url = `/api/genre?genre=${encodeURIComponent(selectedGenre)}`;
    if (selectedGenreMediaType) {
      url += `&type=${selectedGenreMediaType}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    const results = data.results || [];
    if (results.length === 0) {
      grid.innerHTML = `<div class="empty-state">${escapeHtml(i18n("search_empty"))}</div>`;
      return;
    }
    grid.innerHTML = results.map(renderMediaCard).join("");
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Watchlist / Preferiti ───────────────────────────────────────────────────

async function toggleWatchlistCurrent() {
  if (!activeModalItem) return;
  try {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(activeModalItem)
    });
    const data = await res.json();
    const btn = document.getElementById("btnModalWatchlist");
    if (btn) {
      btn.textContent = data.status === "added" ? i18n("watchlist_added") : i18n("watchlist_add");
      btn.className = data.status === "added" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm";
    }
    if (document.getElementById("viewWatchlist")?.classList.contains("active")) {
      loadWatchlist();
    }
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function loadWatchlist() {
  const grid = document.getElementById("watchlistGrid");
  if (!grid) return;
  grid.innerHTML = `<div class="loader-box">${escapeHtml(i18n("loading_details"))}</div>`;
  try {
    const res = await fetch("/api/watchlist");
    const data = await res.json();
    const items = data.watchlist || [];
    if (items.length === 0) {
      grid.innerHTML = `<div class="empty-state">${escapeHtml(i18n("watchlist_empty"))}</div>`;
      return;
    }
    grid.innerHTML = items.map(renderMediaCard).join("");
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Calendario Uscite ───────────────────────────────────────────────────────

async function loadCalendar() {
  const grid = document.getElementById("calendarGrid");
  if (!grid) return;
  grid.innerHTML = `<div class="loader-box">${escapeHtml(i18n("calendar_loading"))}</div>`;
  try {
    const res = await fetch("/api/calendar");
    const data = await res.json();
    const items = data.releases || [];
    if (items.length === 0) {
      grid.innerHTML = `<div class="empty-state">${escapeHtml(i18n("calendar_empty"))}</div>`;
      return;
    }
    grid.innerHTML = items.map(renderMediaCard).join("");
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Statistiche & Archiviazione ─────────────────────────────────────────────

async function loadStats() {
  const container = document.getElementById("statsContainer");
  if (!container) return;
  container.innerHTML = `<div class="loader-box">${escapeHtml(i18n("stats_loading"))}</div>`;
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    const d = data.disk;
    const l = data.library;
    const formatsList = Object.entries(l.formats || {}).map(([ext, count]) => `${ext.toUpperCase()} (${count})`).join(", ") || i18n("stats_none");

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
        <div class="settings-card">
          <h4>${escapeHtml(i18n("stats_disk_space"))}</h4>
          <div style="font-size: 24px; font-weight: 700; margin: 12px 0;">${d.free_gb} ${escapeHtml(i18n("stats_free_gb"))}</div>
          <div class="progress-track" style="height: 10px; margin-bottom: 8px;">
            <div class="progress-fill" style="width: ${d.used_percent}%;"></div>
          </div>
          <div class="text-muted" style="display:flex; justify-content:space-between;">
            <span>${escapeHtml(i18n("stats_used"))}: ${d.used_gb} GB (${d.used_percent}%)</span>
            <span>${escapeHtml(i18n("stats_total"))}: ${d.total_gb} GB</span>
          </div>
        </div>

        <div class="settings-card">
          <h4>${escapeHtml(i18n("stats_local_archive"))}</h4>
          <div style="font-size: 24px; font-weight: 700; margin: 12px 0;">${l.total_files} ${escapeHtml(i18n("stats_files_count"))}</div>
          <div class="text-muted" style="margin-bottom: 6px;">${escapeHtml(i18n("stats_occupied_space"))}: <strong>${l.total_size_gb} GB</strong></div>
          <div class="text-muted">${escapeHtml(i18n("stats_formats"))}: ${escapeHtml(formatsList)}</div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Continua a Guardare ────────────────────────────────────────────────────

async function loadContinueWatching() {
  const section = document.getElementById("continueWatchingSection");
  const slider = document.getElementById("continueWatchingSlider");
  if (!section || !slider) return;
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    const items = data.history || [];
    historyCache = items;
    if (items.length === 0) {
      section.style.display = "none";
      return;
    }
    section.style.display = "block";
    slider.innerHTML = items.map((it, idx) => {
      const art = it.poster || it.cover;
      const posterUrl = art ? `/api/image/${art}` : "";
      const percent = it.duration ? Math.min(100, Math.round((it.current_time / it.duration) * 100)) : 0;
      const safeName = escapeHtml(it.name);
      return `
        <div class="media-card" style="min-width: 150px; cursor:pointer;" onclick="resumeHistoryItem(${idx})">
          <div class="media-poster-wrap">
            ${posterUrl ? `<img class="media-poster" src="${posterUrl}" loading="lazy" alt="${safeName}">` : '<div class="no-poster">AuraFilm</div>'}
            <button style="position:absolute; top:4px; right:4px; background:rgba(0,0,0,0.75); color:#fff; border:none; border-radius:50%; width:20px; height:20px; line-height:18px; font-size:12px; cursor:pointer;" onclick="removeHistoryItem(${Number(it.id)}, ${it.episode_id ? Number(it.episode_id) : 'null'}, event)" title="${escapeHtml(i18n("delete_btn"))}">&times;</button>
            <div class="progress-track" style="position:absolute; bottom:0; left:0; width:100%; height:4px; border-radius:0;">
              <div class="progress-fill" style="width:${percent}%;"></div>
            </div>
          </div>
          <div class="media-info">
            <div class="media-name" title="${safeName}">${safeName}</div>
            <div class="media-meta">${percent}% ${escapeHtml(i18n("completed_pct"))}</div>
          </div>
        </div>
      `;
    }).join("");
  } catch (_) {}
}

function resumeHistoryItem(idx) {
  const it = historyCache[idx];
  if (!it) return;
  let url = `/api/stream/proxy/${it.id}/${encodeURIComponent(it.slug || "")}`;
  if (it.episode_id) {
    url += `?episode_id=${it.episode_id}`;
  }
  openVideoPlayer(url, "hls", it, it.current_time || 0);
}

async function removeHistoryItem(id, epId, e) {
  if (e) e.stopPropagation();
  try {
    const res = await fetch("/api/history/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, episode_id: epId })
    });
    if (res.ok) {
      loadContinueWatching();
    }
  } catch (_) {}
}
