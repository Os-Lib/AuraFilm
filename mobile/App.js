import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  FlatList,
  Image,
  ScrollView,
  ActivityIndicator,
  Modal,
  useWindowDimensions,
  Alert,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';

const GENRES_LIST = [
  'Azione', 'Avventura', 'Animazione', 'Commedia', 'Crime',
  'Documentario', 'Dramma', 'Famiglia', 'Fantasy', 'Fantascienza',
  'Horror', 'Mistero', 'Romantico', 'Thriller', 'Western', 'Guerra'
];

export default function App() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 768;

  // Server & Connection State
  const [serverUrl, setServerUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [connStatus, setConnStatus] = useState('checking');

  // Navigation Tab: 'home' | 'search' | 'downloads' | 'watchlist' | 'settings'
  const [currentTab, setCurrentTab] = useState('home');

  // Home State
  const [shelves, setShelves] = useState([]);
  const [history, setHistory] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState(null); // null | 'movie' | 'tv'
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Downloads & Files State
  const [activeJobs, setActiveJobs] = useState([]);
  const [libraryFiles, setLibraryFiles] = useState([]);
  const [downloadsTab, setDownloadsTab] = useState('jobs'); // 'jobs' | 'files'

  // Watchlist State
  const [watchlist, setWatchlist] = useState([]);

  // Title Details Modal State
  const [selectedTitle, setSelectedTitle] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [seasonEpisodes, setSeasonEpisodes] = useState([]);
  const [audioIta, setAudioIta] = useState(true);
  const [audioEng, setAudioEng] = useState(false);

  // Video Player Modal State
  const [playerVisible, setPlayerVisible] = useState(false);
  const [playerUrl, setPlayerUrl] = useState('');
  const [playerTitle, setPlayerTitle] = useState('');

  useEffect(() => {
    initApp();
  }, []);

  const initApp = async () => {
    try {
      const saved = await AsyncStorage.getItem('@aurafilm_url');
      if (saved) {
        setServerUrl(saved);
        setInputUrl(saved);
        await testAndLoad(saved);
      } else {
        setConnStatus('disconnected');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const testAndLoad = async (url) => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`${url}/api/status`, { timeout: 6000 });
      if (res.ok) {
        setConnStatus('connected');
        loadHomeData(url);
      } else {
        setConnStatus('error');
      }
    } catch (e) {
      setConnStatus('error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const saveUrl = async () => {
    let finalUrl = inputUrl.trim();
    if (!finalUrl) return;
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'http://' + finalUrl;
    }
    if (finalUrl.endsWith('/')) {
      finalUrl = finalUrl.slice(0, -1);
    }

    try {
      await AsyncStorage.setItem('@aurafilm_url', finalUrl);
      setServerUrl(finalUrl);
      testAndLoad(finalUrl);
    } catch (e) {
      console.error(e);
    }
  };

  const disconnectServer = async () => {
    await AsyncStorage.removeItem('@aurafilm_url');
    setServerUrl('');
    setShelves([]);
    setConnStatus('disconnected');
    setCurrentTab('settings');
  };

  // ── Home Data ──────────────────────────────────────────────────────────────

  const loadHomeData = async (url = serverUrl) => {
    if (!url) return;
    setIsRefreshing(true);
    try {
      const [shelvesRes, historyRes] = await Promise.all([
        fetch(`${url}/api/shelves`),
        fetch(`${url}/api/history`).catch(() => ({ ok: false }))
      ]);

      if (shelvesRes.ok) {
        const sData = await shelvesRes.json();
        setShelves(sData.shelves || []);
      }

      if (historyRes.ok) {
        const hData = await historyRes.json();
        setHistory(hData.history || []);
      }
    } catch (e) {
      console.error('Home load error:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // ── Search ─────────────────────────────────────────────────────────────────

  const handleSearch = async (query = searchQuery, type = searchType) => {
    if (!query.trim() || !serverUrl) return;
    setIsSearching(true);
    try {
      let endpoint = `${serverUrl}/api/search?q=${encodeURIComponent(query)}`;
      if (type) endpoint += `&type=${type}`;
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      }
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      setIsSearching(false);
    }
  };

  // ── Downloads & Library ────────────────────────────────────────────────────

  const loadDownloads = async () => {
    if (!serverUrl) return;
    try {
      const [jobsRes, filesRes] = await Promise.all([
        fetch(`${serverUrl}/api/jobs`),
        fetch(`${serverUrl}/api/files`)
      ]);
      if (jobsRes.ok) {
        const jData = await jobsRes.json();
        setActiveJobs(jData.jobs || []);
      }
      if (filesRes.ok) {
        const fData = await filesRes.json();
        setLibraryFiles(fData.files || []);
      }
    } catch (e) {
      console.error('Downloads load error:', e);
    }
  };

  const cancelJob = async (jobId) => {
    try {
      await fetch(`${serverUrl}/api/jobs/${jobId}/cancel`, { method: 'POST' });
      loadDownloads();
    } catch (e) {
      console.error(e);
    }
  };

  // ── Watchlist ──────────────────────────────────────────────────────────────

  const loadWatchlist = async () => {
    if (!serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}/api/watchlist`);
      if (res.ok) {
        const data = await res.json();
        setWatchlist(data.watchlist || []);
      }
    } catch (e) {
      console.error('Watchlist error:', e);
    }
  };

  const toggleWatchlist = async (item) => {
    if (!serverUrl || !item) return;
    try {
      await fetch(`${serverUrl}/api/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          name: item.name,
          slug: item.slug,
          poster: item.poster || (item.images && item.images.poster) || '',
          type: item.type || 'movie',
          year: item.year || ''
        })
      });
      loadWatchlist();
    } catch (e) {
      console.error(e);
    }
  };

  // ── Title Details ──────────────────────────────────────────────────────────

  const openTitleDetails = async (id, slug) => {
    if (!serverUrl) return;
    setDetailLoading(true);
    setSelectedTitle(null);
    setSeasonEpisodes([]);
    try {
      const res = await fetch(`${serverUrl}/api/title/${id}/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedTitle(data);
        if (data.type !== 'movie' && data.seasons && data.seasons.length > 0) {
          const firstSeason = data.seasons[0].number;
          setSelectedSeason(firstSeason);
          loadEpisodes(data.id, data.slug, firstSeason);
        }
      }
    } catch (e) {
      Alert.alert('Errore', 'Impossibile caricare i dettagli del titolo.');
    } finally {
      setDetailLoading(false);
    }
  };

  const loadEpisodes = async (id, slug, seasonNum) => {
    try {
      const res = await fetch(`${serverUrl}/api/title/${id}/${slug}/season/${seasonNum}`);
      if (res.ok) {
        const data = await res.json();
        setSeasonEpisodes(data.episodes || []);
      }
    } catch (e) {
      console.error('Episodes error:', e);
    }
  };

  // ── Actions: Download & Play ───────────────────────────────────────────────

  const startDownloadMovie = async () => {
    if (!selectedTitle || !serverUrl) return;
    const languages = [];
    if (audioIta) languages.push('ita');
    if (audioEng) languages.push('eng');

    try {
      const res = await fetch(`${serverUrl}/api/jobs/movie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title_id: selectedTitle.id,
          slug: selectedTitle.slug,
          title_name: selectedTitle.name,
          year: selectedTitle.year || '',
          languages: languages.length > 0 ? languages : ['ita']
        })
      });
      if (res.ok) {
        Alert.alert('Download avviato', `Il download di "${selectedTitle.name}" e stato aggiunto alla coda.`);
        setSelectedTitle(null);
        setCurrentTab('downloads');
        loadDownloads();
      } else {
        Alert.alert('Errore', 'Impossibile avviare il download.');
      }
    } catch (e) {
      Alert.alert('Errore di connessione', e.message);
    }
  };

  const startDownloadEpisode = async (ep) => {
    if (!selectedTitle || !serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}/api/jobs/episode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title_id: selectedTitle.id,
          slug: selectedTitle.slug,
          tv_name: selectedTitle.name,
          season_number: selectedSeason,
          episode_id: ep.id,
          episode_number: ep.number,
          episode_name: ep.name || `Episodio ${ep.number}`,
          year: selectedTitle.year || '',
          languages: ['ita']
        })
      });
      if (res.ok) {
        Alert.alert('Download avviato', `Episodio ${ep.number} aggiunto alla coda.`);
      }
    } catch (e) {
      Alert.alert('Errore', e.message);
    }
  };

  const playStream = (url, title) => {
    setPlayerUrl(url);
    setPlayerTitle(title);
    setPlayerVisible(true);
  };

  // ── Render Helpers ─────────────────────────────────────────────────────────

  const cardWidth = isTablet ? 180 : Math.floor((width - 48) / 3);
  const cardHeight = Math.floor(cardWidth * 1.5);

  const renderMediaCard = (item) => {
    const poster = item.poster || (item.images && item.images.poster);
    const posterUri = poster ? `${serverUrl}/api/image/${poster}` : null;

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.mediaCard, { width: cardWidth }]}
        activeOpacity={0.8}
        onPress={() => openTitleDetails(item.id, item.slug)}
      >
        <View style={[styles.posterWrap, { width: cardWidth, height: cardHeight }]}>
          {posterUri ? (
            <Image source={{ uri: posterUri }} style={styles.posterImg} resizeMode="cover" />
          ) : (
            <View style={styles.noPoster}>
              <Text style={styles.noPosterText}>N/D</Text>
            </View>
          )}
          {item.score ? (
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreText}>★ {item.score}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {item.year || ''} {item.type === 'tv' ? '• Serie' : '• Film'}
        </Text>
      </TouchableOpacity>
    );
  };

  // ── Player HTML Template ───────────────────────────────────────────────────

  const getPlayerHtml = () => `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body, html { width: 100%; height: 100%; background: #000; display: flex; align-items: center; justify-content: center; overflow: hidden; }
          video { width: 100%; height: 100%; object-fit: contain; }
        </style>
      </head>
      <body>
        <video id="videoPlayer" controls autoplay playsinline></video>
        <script>
          const video = document.getElementById('videoPlayer');
          const streamUrl = "${playerUrl}";
          if (Hls.isSupported() && (streamUrl.includes('.m3u8') || streamUrl.includes('/proxy/'))) {
            const hls = new Hls({ enableWorker: true });
            hls.loadSource(streamUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
              if (hls.levels && hls.levels.length > 0) {
                hls.currentLevel = hls.levels.length - 1; // Massima risoluzione
              }
              video.play().catch(e => console.log(e));
            });
          } else {
            video.src = streamUrl;
            video.play().catch(e => console.log(e));
          }
        </script>
      </body>
    </html>
  `;

  // ── Loading Screen ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={styles.splashScreen}>
        <ActivityIndicator size="large" color="#00d2ff" />
        <Text style={styles.splashText}>Inizializzazione AuraFilm...</Text>
      </View>
    );
  }

  // ── Setup Server Screen ────────────────────────────────────────────────────

  if (!serverUrl || connStatus === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />
        <View style={styles.setupCard}>
          <Text style={styles.setupBrand}>AuraFilm</Text>
          <Text style={styles.setupTagline}>Client mobile nativo per streaming e download</Text>

          <Text style={styles.inputLabel}>Indirizzo del server (es. http://192.168.1.45:8080)</Text>
          <TextInput
            style={styles.textInput}
            value={inputUrl}
            onChangeText={setInputUrl}
            placeholder="http://192.168.1.45:8080"
            placeholderTextColor="#4a5568"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {connStatus === 'error' ? (
            <Text style={styles.errorBanner}>
              Impossibile raggiungere il server. Verifica che il PC sia acceso e sulla stessa rete Wi-Fi.
            </Text>
          ) : null}

          <TouchableOpacity style={styles.primaryBtn} onPress={saveUrl} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Connetti Server</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main App Shell ─────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.brandTitle}>AuraFilm</Text>
          <Text style={styles.brandSubtitle}>Media Player & Suite</Text>
        </View>
        <View style={styles.serverStatusTag}>
          <View style={[styles.statusDot, { backgroundColor: connStatus === 'connected' ? '#00e676' : '#ff5252' }]} />
          <Text style={styles.serverStatusText}>{connStatus === 'connected' ? 'Online' : 'Offline'}</Text>
        </View>
      </View>

      {/* Body Views */}
      <View style={styles.mainContent}>

        {/* 1. HOME TAB */}
        {currentTab === 'home' && (
          <ScrollView
            style={styles.scrollArea}
            showsVerticalScrollIndicator={false}
          >
            {/* Continua a guardare */}
            {history.length > 0 && (
              <View style={styles.sectionWrap}>
                <Text style={styles.sectionHeader}>Continua a guardare</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowPadding}>
                  {history.map(item => {
                    const posterUri = item.poster ? `${serverUrl}/api/image/${item.poster}` : null;
                    const percent = item.duration ? Math.min(100, Math.round((item.current_time / item.duration) * 100)) : 0;
                    return (
                      <TouchableOpacity
                        key={`${item.id}_${item.episode_id || ''}`}
                        style={[styles.historyCard, { width: cardWidth }]}
                        onPress={() => openTitleDetails(item.id, item.slug)}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.posterWrap, { width: cardWidth, height: cardHeight }]}>
                          {posterUri ? <Image source={{ uri: posterUri }} style={styles.posterImg} /> : null}
                          <View style={styles.historyBarWrap}>
                            <View style={[styles.historyBarFill, { width: `${percent}%` }]} />
                          </View>
                        </View>
                        <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.cardMeta}>{percent}% completato</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Sliders Standard */}
            {shelves.map(shelf => (
              <View key={shelf.key || shelf.label} style={styles.sectionWrap}>
                <Text style={styles.sectionHeader}>{shelf.label || shelf.key}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowPadding}>
                  {shelf.items.map(item => renderMediaCard(item))}
                </ScrollView>
              </View>
            ))}

            {/* Generi in fondo alla Home */}
            <View style={styles.genreSectionWrap}>
              <Text style={styles.sectionHeader}>Esplora per genere</Text>
              <View style={styles.genreChipsRow}>
                {GENRES_LIST.map(g => (
                  <TouchableOpacity
                    key={g}
                    style={styles.genreChip}
                    onPress={() => {
                      setSearchQuery(g);
                      setCurrentTab('search');
                      handleSearch(g, searchType);
                    }}
                  >
                    <Text style={styles.genreChipText}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        )}

        {/* 2. SEARCH TAB */}
        {currentTab === 'search' && (
          <View style={styles.tabContainer}>
            <View style={styles.searchBarWrap}>
              <TextInput
                style={styles.searchInput}
                placeholder="Cerca film, serie tv, attori..."
                placeholderTextColor="#64748b"
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={() => handleSearch()}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.searchSubmitBtn} onPress={() => handleSearch()}>
                <Text style={styles.searchSubmitText}>Cerca</Text>
              </TouchableOpacity>
            </View>

            {/* Filtri tipo */}
            <View style={styles.typeFilterRow}>
              <TouchableOpacity
                style={[styles.filterChip, searchType === null && styles.filterChipActive]}
                onPress={() => { setSearchType(null); handleSearch(searchQuery, null); }}
              >
                <Text style={[styles.filterChipText, searchType === null && styles.filterChipTextActive]}>Tutti</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, searchType === 'movie' && styles.filterChipActive]}
                onPress={() => { setSearchType('movie'); handleSearch(searchQuery, 'movie'); }}
              >
                <Text style={[styles.filterChipText, searchType === 'movie' && styles.filterChipTextActive]}>Solo Film</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, searchType === 'tv' && styles.filterChipActive]}
                onPress={() => { setSearchType('tv'); handleSearch(searchQuery, 'tv'); }}
              >
                <Text style={[styles.filterChipText, searchType === 'tv' && styles.filterChipTextActive]}>Solo Serie</Text>
              </TouchableOpacity>
            </View>

            {isSearching ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color="#00d2ff" />
                <Text style={styles.dimmedText}>Ricerca in corso...</Text>
              </View>
            ) : (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id.toString()}
                numColumns={isTablet ? 5 : 3}
                contentContainerStyle={styles.gridContent}
                renderItem={({ item }) => renderMediaCard(item)}
                ListEmptyComponent={
                  <View style={styles.centerBox}>
                    <Text style={styles.dimmedText}>Inserisci un termine di ricerca o seleziona un genere.</Text>
                  </View>
                }
              />
            )}
          </View>
        )}

        {/* 3. DOWNLOADS & FILES TAB */}
        {currentTab === 'downloads' && (
          <View style={styles.tabContainer}>
            <View style={styles.subTabHeader}>
              <TouchableOpacity
                style={[styles.subTabBtn, downloadsTab === 'jobs' && styles.subTabBtnActive]}
                onPress={() => { setDownloadsTab('jobs'); loadDownloads(); }}
              >
                <Text style={[styles.subTabText, downloadsTab === 'jobs' && styles.subTabTextActive]}>
                  In corso ({activeJobs.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subTabBtn, downloadsTab === 'files' && styles.subTabBtnActive]}
                onPress={() => { setDownloadsTab('files'); loadDownloads(); }}
              >
                <Text style={[styles.subTabText, downloadsTab === 'files' && styles.subTabTextActive]}>
                  Libreria Locale ({libraryFiles.length})
                </Text>
              </TouchableOpacity>
            </View>

            {downloadsTab === 'jobs' ? (
              <FlatList
                data={activeJobs}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                  <View style={styles.jobItemCard}>
                    <View style={styles.jobRow}>
                      <Text style={styles.jobName} numberOfLines={1}>{item.title_name}</Text>
                      <Text style={styles.jobPercent}>{Math.round(item.percent || 0)}%</Text>
                    </View>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${item.percent || 0}%` }]} />
                    </View>
                    <View style={styles.jobFooter}>
                      <Text style={styles.jobPhase}>{item.phase || item.status}</Text>
                      {item.status === 'downloading' ? (
                        <TouchableOpacity onPress={() => cancelJob(item.id)}>
                          <Text style={styles.cancelText}>Annulla</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                )}
                ListEmptyComponent={
                  <View style={styles.centerBox}>
                    <Text style={styles.dimmedText}>Nessun download attivo in coda.</Text>
                  </View>
                }
              />
            ) : (
              <FlatList
                data={libraryFiles}
                keyExtractor={(item) => item.path}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                  <View style={styles.fileItemCard}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.fileSize}>{item.size_mb} MB</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.playFileBtn}
                      onPress={() => playStream(`${serverUrl}/api/files/download/${encodeURIComponent(item.path)}`, item.name)}
                    >
                      <Text style={styles.playFileBtnText}>Riproduci</Text>
                    </TouchableOpacity>
                  </View>
                )}
                ListEmptyComponent={
                  <View style={styles.centerBox}>
                    <Text style={styles.dimmedText}>Nessun file scaricato nell'archivio.</Text>
                  </View>
                }
              />
            )}
          </View>
        )}

        {/* 4. PREFERITI (WATCHLIST) */}
        {currentTab === 'watchlist' && (
          <View style={styles.tabContainer}>
            <View style={styles.headerPad}>
              <Text style={styles.sectionHeader}>I tuoi Preferiti</Text>
            </View>
            <FlatList
              data={watchlist}
              keyExtractor={(item) => item.id.toString()}
              numColumns={isTablet ? 5 : 3}
              contentContainerStyle={styles.gridContent}
              renderItem={({ item }) => renderMediaCard(item)}
              ListEmptyComponent={
                <View style={styles.centerBox}>
                  <Text style={styles.dimmedText}>Nessun titolo salvato nei preferiti.</Text>
                </View>
              }
            />
          </View>
        )}

        {/* 5. SETTINGS TAB */}
        {currentTab === 'settings' && (
          <ScrollView style={styles.scrollArea}>
            <View style={styles.settingsWrapper}>
              <View style={styles.settingsSection}>
                <Text style={styles.settingGroupTitle}>Connessione Server</Text>
                <Text style={styles.settingLabel}>URL Server Attuale</Text>
                <Text style={styles.settingValue}>{serverUrl}</Text>
                <TouchableOpacity
                  style={[styles.primaryBtn, { marginTop: 12 }]}
                  onPress={() => testAndLoad(serverUrl)}
                >
                  <Text style={styles.primaryBtnText}>Test Connessione</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.settingsSection}>
                <Text style={styles.settingGroupTitle}>Gestione Account</Text>
                <TouchableOpacity style={styles.dangerBtn} onPress={disconnectServer}>
                  <Text style={styles.dangerBtnText}>Disconnetti e Cambia Server</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        )}

      </View>

      {/* Bottom Navigation Bar */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[styles.navBtn, currentTab === 'home' && styles.navBtnActive]}
          onPress={() => { setCurrentTab('home'); loadHomeData(); }}
        >
          <Text style={[styles.navBtnText, currentTab === 'home' && styles.navBtnTextActive]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, currentTab === 'search' && styles.navBtnActive]}
          onPress={() => setCurrentTab('search')}
        >
          <Text style={[styles.navBtnText, currentTab === 'search' && styles.navBtnTextActive]}>Cerca</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, currentTab === 'downloads' && styles.navBtnActive]}
          onPress={() => { setCurrentTab('downloads'); loadDownloads(); }}
        >
          <Text style={[styles.navBtnText, currentTab === 'downloads' && styles.navBtnTextActive]}>Download</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, currentTab === 'watchlist' && styles.navBtnActive]}
          onPress={() => { setCurrentTab('watchlist'); loadWatchlist(); }}
        >
          <Text style={[styles.navBtnText, currentTab === 'watchlist' && styles.navBtnTextActive]}>Preferiti</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, currentTab === 'settings' && styles.navBtnActive]}
          onPress={() => setCurrentTab('settings')}
        >
          <Text style={[styles.navBtnText, currentTab === 'settings' && styles.navBtnTextActive]}>Opzioni</Text>
        </TouchableOpacity>
      </View>

      {/* ── Title Details Modal ────────────────────────────────────────────── */}
      <Modal visible={!!selectedTitle || detailLoading} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.modalContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />
          {detailLoading || !selectedTitle ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color="#00d2ff" />
              <Text style={styles.dimmedText}>Caricamento scheda titolo...</Text>
            </View>
          ) : (
            <ScrollView style={styles.scrollArea}>
              <View style={styles.detailHeader}>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedTitle(null)}>
                  <Text style={styles.closeBtnText}>Chiudi</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.favBtn}
                  onPress={() => toggleWatchlist(selectedTitle)}
                >
                  <Text style={styles.favBtnText}>Salva nei Preferiti</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.detailBody}>
                <View style={styles.detailTopRow}>
                  {selectedTitle.poster ? (
                    <Image
                      source={{ uri: `${serverUrl}/api/image/${selectedTitle.poster}` }}
                      style={styles.detailPoster}
                    />
                  ) : null}
                  <View style={styles.detailInfoCol}>
                    <Text style={styles.detailMainTitle}>{selectedTitle.name}</Text>
                    <Text style={styles.detailSubMeta}>
                      {selectedTitle.year || ''} • {selectedTitle.type === 'tv' ? 'Serie TV' : 'Film'}
                      {selectedTitle.score ? ` • ★ ${selectedTitle.score}` : ''}
                    </Text>
                    {selectedTitle.runtime ? (
                      <Text style={styles.detailRuntime}>{selectedTitle.runtime} minuti</Text>
                    ) : null}
                  </View>
                </View>

                <Text style={styles.plotText}>{selectedTitle.plot || 'Nessuna trama disponibile.'}</Text>

                {/* Sezione Film */}
                {selectedTitle.type === 'movie' ? (
                  <View style={styles.actionsPanel}>
                    <Text style={styles.panelTitle}>Tracce Audio</Text>
                    <View style={styles.audioOptions}>
                      <TouchableOpacity
                        style={[styles.audioToggle, audioIta && styles.audioToggleActive]}
                        onPress={() => setAudioIta(!audioIta)}
                      >
                        <Text style={[styles.audioToggleText, audioIta && styles.audioToggleTextActive]}>Italiano</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.audioToggle, audioEng && styles.audioToggleActive]}
                        onPress={() => setAudioEng(!audioEng)}
                      >
                        <Text style={[styles.audioToggleText, audioEng && styles.audioToggleTextActive]}>Originale / ENG</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.actionButtonsRow}>
                      <TouchableOpacity
                        style={styles.primaryActionBtn}
                        onPress={() => playStream(`${serverUrl}/api/stream/proxy/${selectedTitle.id}/${selectedTitle.slug}`, selectedTitle.name)}
                      >
                        <Text style={styles.primaryActionText}>Riproduci (Streaming)</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.secondaryActionBtn} onPress={startDownloadMovie}>
                        <Text style={styles.secondaryActionText}>Download</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  /* Sezione Serie TV */
                  <View style={styles.actionsPanel}>
                    <Text style={styles.panelTitle}>Stagioni</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 10 }}>
                      {(selectedTitle.seasons || []).map(s => (
                        <TouchableOpacity
                          key={s.number}
                          style={[styles.seasonChip, selectedSeason === s.number && styles.seasonChipActive]}
                          onPress={() => {
                            setSelectedSeason(s.number);
                            loadEpisodes(selectedTitle.id, selectedTitle.slug, s.number);
                          }}
                        >
                          <Text style={[styles.seasonChipText, selectedSeason === s.number && styles.seasonChipTextActive]}>
                            Stagione {s.number}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    <Text style={[styles.panelTitle, { marginTop: 16 }]}>Episodi</Text>
                    {seasonEpisodes.map(ep => (
                      <View key={ep.id} style={styles.episodeCard}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={styles.episodeTitle}>E{ep.number} - {ep.name || `Episodio ${ep.number}`}</Text>
                          {ep.duration ? <Text style={styles.episodeDuration}>{ep.duration} min</Text> : null}
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <TouchableOpacity
                            style={styles.epPlayBtn}
                            onPress={() => playStream(`${serverUrl}/api/stream/proxy/${selectedTitle.id}/${selectedTitle.slug}?episode_id=${ep.id}`, `${selectedTitle.name} E${ep.number}`)}
                          >
                            <Text style={styles.epPlayText}>Riproduci</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.epDlBtn} onPress={() => startDownloadEpisode(ep)}>
                            <Text style={styles.epDlText}>Scarica</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* ── Fullscreen Video Player Modal ──────────────────────────────────── */}
      <Modal visible={playerVisible} animationType="fade" transparent={false}>
        <SafeAreaView style={styles.playerContainer}>
          <StatusBar hidden />
          <View style={styles.playerHeader}>
            <Text style={styles.playerHeaderTitle} numberOfLines={1}>{playerTitle}</Text>
            <TouchableOpacity style={styles.playerCloseBtn} onPress={() => setPlayerVisible(false)}>
              <Text style={styles.playerCloseText}>Chiudi</Text>
            </TouchableOpacity>
          </View>
          <WebView
            source={{ html: getPlayerHtml() }}
            style={styles.webview}
            allowsFullscreenVideo={true}
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            originWhitelist={['*']}
          />
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

// ── Stylesheet ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f19' },
  splashScreen: { flex: 1, backgroundColor: '#0b0f19', justifyContent: 'center', alignItems: 'center' },
  splashText: { color: '#94a3b8', marginTop: 14, fontSize: 15 },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30, minHeight: 250 },
  dimmedText: { color: '#64748b', fontSize: 15, marginTop: 10, textAlign: 'center' },

  // Setup Screen
  setupCard: { flex: 1, justifyContent: 'center', padding: 28 },
  setupBrand: { fontSize: 36, fontWeight: '800', color: '#00d2ff', textAlign: 'center', letterSpacing: 0.5 },
  setupTagline: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginTop: 8, marginBottom: 36 },
  inputLabel: { color: '#cbd5e1', fontSize: 13, marginBottom: 8, fontWeight: '600' },
  textInput: { backgroundColor: '#131b2e', borderWidth: 1, borderColor: '#1e293b', borderRadius: 8, color: '#f8fafc', padding: 14, fontSize: 15, marginBottom: 16 },
  primaryBtn: { backgroundColor: '#00d2ff', padding: 15, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#0b0f19', fontSize: 15, fontWeight: '700' },
  errorBanner: { color: '#f87171', fontSize: 13, textAlign: 'center', marginBottom: 16, lineHeight: 18 },

  // Top Bar
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  brandTitle: { fontSize: 20, fontWeight: '800', color: '#f8fafc', letterSpacing: 0.5 },
  brandSubtitle: { fontSize: 11, color: '#64748b' },
  serverStatusTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#131b2e', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  serverStatusText: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },

  // Main Content
  mainContent: { flex: 1 },
  scrollArea: { flex: 1 },
  tabContainer: { flex: 1 },

  // Home
  sectionWrap: { marginTop: 22 },
  sectionHeader: { fontSize: 17, fontWeight: '700', color: '#f8fafc', marginHorizontal: 16, marginBottom: 12 },
  rowPadding: { paddingHorizontal: 16, gap: 12 },
  genreSectionWrap: { marginTop: 32, paddingHorizontal: 16 },
  genreChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  genreChip: { backgroundColor: '#162136', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1e293b' },
  genreChipText: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },

  // Media Card
  mediaCard: { backgroundColor: '#131b2e', borderRadius: 8, overflow: 'hidden' },
  historyCard: { backgroundColor: '#131b2e', borderRadius: 8, overflow: 'hidden', marginRight: 12 },
  posterWrap: { backgroundColor: '#1e293b', position: 'relative' },
  posterImg: { width: '100%', height: '100%' },
  noPoster: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noPosterText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
  scoreBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(11,15,25,0.85)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  scoreText: { color: '#f5c518', fontSize: 10, fontWeight: '700' },
  cardTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '700', marginTop: 8, marginHorizontal: 8 },
  cardMeta: { color: '#64748b', fontSize: 11, marginBottom: 8, marginHorizontal: 8 },
  historyBarWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, backgroundColor: '#1e293b' },
  historyBarFill: { height: '100%', backgroundColor: '#00d2ff' },

  // Search
  searchBarWrap: { flexDirection: 'row', padding: 16, gap: 8 },
  searchInput: { flex: 1, backgroundColor: '#131b2e', borderWidth: 1, borderColor: '#1e293b', borderRadius: 8, color: '#f8fafc', paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  searchSubmitBtn: { backgroundColor: '#00d2ff', justifyContent: 'center', paddingHorizontal: 18, borderRadius: 8 },
  searchSubmitText: { color: '#0b0f19', fontWeight: '700', fontSize: 14 },
  typeFilterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#131b2e' },
  filterChipActive: { backgroundColor: '#00d2ff' },
  filterChipText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#0b0f19' },
  gridContent: { padding: 12, gap: 12 },

  // Downloads & Files
  subTabHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1e293b', marginHorizontal: 16, marginTop: 10 },
  subTabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  subTabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#00d2ff' },
  subTabText: { color: '#64748b', fontSize: 14, fontWeight: '600' },
  subTabTextActive: { color: '#00d2ff' },
  listContent: { padding: 16, gap: 10 },
  jobItemCard: { backgroundColor: '#131b2e', padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b' },
  jobRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  jobName: { color: '#f8fafc', fontSize: 14, fontWeight: '700', flex: 1 },
  jobPercent: { color: '#00d2ff', fontSize: 13, fontWeight: '700', marginLeft: 8 },
  progressBar: { height: 6, backgroundColor: '#1e293b', borderRadius: 3, overflow: 'hidden', marginVertical: 6 },
  progressFill: { height: '100%', backgroundColor: '#00d2ff' },
  jobFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  jobPhase: { color: '#64748b', fontSize: 11, textTransform: 'capitalize' },
  cancelText: { color: '#f87171', fontSize: 12, fontWeight: '600' },
  fileItemCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#131b2e', padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b' },
  fileName: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },
  fileSize: { color: '#64748b', fontSize: 12, marginTop: 3 },
  playFileBtn: { backgroundColor: '#1e293b', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  playFileBtnText: { color: '#00d2ff', fontSize: 13, fontWeight: '700' },

  // Settings
  headerPad: { paddingHorizontal: 16, paddingTop: 16 },
  settingsWrapper: { padding: 16, gap: 16 },
  settingsSection: { backgroundColor: '#131b2e', padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b' },
  settingGroupTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  settingLabel: { color: '#64748b', fontSize: 12, marginBottom: 4 },
  settingValue: { color: '#cbd5e1', fontSize: 14, fontWeight: '600' },
  dangerBtn: { backgroundColor: '#1f1315', borderWidth: 1, borderColor: '#7f1d1d', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  dangerBtnText: { color: '#f87171', fontSize: 14, fontWeight: '700' },

  // Bottom Nav
  bottomNav: { flexDirection: 'row', backgroundColor: '#0b0f19', borderTopWidth: 1, borderTopColor: '#1e293b', paddingVertical: 8 },
  navBtn: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  navBtnActive: {},
  navBtnText: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  navBtnTextActive: { color: '#00d2ff' },

  // Detail Modal
  modalContainer: { flex: 1, backgroundColor: '#0b0f19' },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  closeBtn: { padding: 8, backgroundColor: '#131b2e', borderRadius: 6 },
  closeBtnText: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  favBtn: { padding: 8, backgroundColor: '#131b2e', borderRadius: 6 },
  favBtnText: { color: '#00d2ff', fontSize: 13, fontWeight: '600' },
  detailBody: { padding: 16 },
  detailTopRow: { flexDirection: 'row', gap: 16 },
  detailPoster: { width: 110, height: 165, borderRadius: 8, backgroundColor: '#1e293b' },
  detailInfoCol: { flex: 1, justifyContent: 'center' },
  detailMainTitle: { fontSize: 20, fontWeight: '800', color: '#f8fafc', marginBottom: 6 },
  detailSubMeta: { color: '#94a3b8', fontSize: 13, marginBottom: 4 },
  detailRuntime: { color: '#64748b', fontSize: 12 },
  plotText: { color: '#cbd5e1', fontSize: 14, lineHeight: 22, marginTop: 16 },

  // Detail Actions
  actionsPanel: { marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1e293b' },
  panelTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700', marginBottom: 10 },
  audioOptions: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  audioToggle: { backgroundColor: '#131b2e', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#1e293b' },
  audioToggleActive: { backgroundColor: '#1e293b', borderColor: '#00d2ff' },
  audioToggleText: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  audioToggleTextActive: { color: '#00d2ff' },
  actionButtonsRow: { flexDirection: 'row', gap: 10 },
  primaryActionBtn: { flex: 2, backgroundColor: '#00d2ff', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  primaryActionText: { color: '#0b0f19', fontSize: 14, fontWeight: '700' },
  secondaryActionBtn: { flex: 1, backgroundColor: '#131b2e', borderWidth: 1, borderColor: '#1e293b', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  secondaryActionText: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },

  // Episodes List
  seasonChip: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#131b2e', borderRadius: 6, marginRight: 8 },
  seasonChipActive: { backgroundColor: '#00d2ff' },
  seasonChipText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  seasonChipTextActive: { color: '#0b0f19' },
  episodeCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#131b2e', padding: 12, borderRadius: 6, marginTop: 8 },
  episodeTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '600' },
  episodeDuration: { color: '#64748b', fontSize: 11, marginTop: 2 },
  epPlayBtn: { backgroundColor: '#00d2ff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 },
  epPlayText: { color: '#0b0f19', fontSize: 12, fontWeight: '700' },
  epDlBtn: { backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 },
  epDlText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },

  // Fullscreen Video Player
  playerContainer: { flex: 1, backgroundColor: '#000' },
  playerHeader: { height: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, backgroundColor: '#0b0f19' },
  playerHeaderTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '700', flex: 1 },
  playerCloseBtn: { padding: 6, backgroundColor: '#1e293b', borderRadius: 4, marginLeft: 10 },
  playerCloseText: { color: '#00d2ff', fontSize: 12, fontWeight: '700' },
  webview: { flex: 1, backgroundColor: '#000' },
});
