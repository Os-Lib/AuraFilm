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
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';

// Error Boundary to prevent any unhandled crash from killing the native app
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />
          <View style={styles.setupCard}>
            <Text style={styles.setupBrand}>AuraFilm</Text>
            <View style={styles.errorBox}>
              <Text style={styles.errorBanner}>An unexpected error occurred in the UI.</Text>
              <Text style={styles.errorDetail}>
                {this.state.error ? this.state.error.toString() : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => this.setState({ hasError: false, error: null })}
            >
              <Text style={styles.primaryBtnText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dangerBtn}
              onPress={async () => {
                try {
                  await AsyncStorage.clear();
                } catch (e) {}
                this.setState({ hasError: false, error: null });
              }}
            >
              <Text style={styles.dangerBtnText}>Reset App Data & Reconnect</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const TRANSLATIONS = {
  en: {
    appTitle: 'AuraFilm',
    appSubtitle: 'Media Player & Suite',
    setupTagline: 'Native mobile client for streaming and downloads',
    serverAddressLabel: 'Server Address (e.g. http://192.168.x.x:8080)',
    serverAddressPlaceholder: 'http://192.168.x.x:8080',
    connectServer: 'Connect Server',
    connecting: 'Connecting...',
    connectionError: 'Unable to reach the server. Make sure AuraFilm is running on your PC and your device is on the same network (or VPN).',
    errorDetailPrefix: 'Detail: ',
    online: 'Online',
    offline: 'Offline',

    // Tabs
    tabHome: 'Home',
    tabSearch: 'Search',
    tabDownloads: 'Downloads',
    tabWatchlist: 'Watchlist',
    tabSettings: 'Settings',

    // Home
    continueWatching: 'Continue Watching',
    completed: 'completed',
    browseGenres: 'Browse by Genre',
    noContent: 'No content available',

    // Search
    searchPlaceholder: 'Search movies, TV shows, actors...',
    searchBtn: 'Search',
    filterAll: 'All',
    filterMovies: 'Movies',
    filterSeries: 'TV Shows',
    searchPrompt: 'Enter a search query or pick a genre.',
    searching: 'Searching...',

    // Downloads
    inProgress: 'In Progress',
    localLibrary: 'Local Library',
    noActiveDownloads: 'No active downloads in queue.',
    noLocalFiles: 'No downloaded files found.',
    cancel: 'Cancel',
    play: 'Play',

    // Watchlist
    watchlistHeader: 'Your Watchlist',
    noWatchlist: 'No titles saved in your watchlist.',
    saveToWatchlist: 'Save to Watchlist',
    removeFromWatchlist: 'Remove from Watchlist',

    // Detail Modal
    close: 'Close',
    movie: 'Movie',
    tvShow: 'TV Show',
    minutes: 'min',
    noPlot: 'No synopsis available.',
    audioTracks: 'Audio Tracks',
    italian: 'Italian',
    originalEng: 'Original / ENG',
    streamPlay: 'Stream Now',
    download: 'Download',
    seasons: 'Seasons',
    seasonPrefix: 'Season ',
    episodes: 'Episodes',
    episodePrefix: 'Episode ',

    // Settings
    serverConnection: 'Server Connection',
    currentServerUrl: 'Current Server URL',
    testConnection: 'Test Connection',
    accountManagement: 'Server Management',
    disconnectServer: 'Disconnect Server',
    appPreferences: 'App Preferences',
    language: 'Language',
    langEn: 'English',
    langIt: 'Italiano',
  },
  it: {
    appTitle: 'AuraFilm',
    appSubtitle: 'Media Player & Suite',
    setupTagline: 'Client mobile nativo per streaming e download',
    serverAddressLabel: 'Indirizzo del server (es. http://192.168.x.x:8080)',
    serverAddressPlaceholder: 'http://192.168.x.x:8080',
    connectServer: 'Connetti Server',
    connecting: 'Connessione in corso...',
    connectionError: 'Impossibile raggiungere il server. Verifica che AuraFilm sia avviato sul PC e che il dispositivo sia connesso alla stessa rete (o VPN).',
    errorDetailPrefix: 'Dettaglio: ',
    online: 'Online',
    offline: 'Offline',

    // Tabs
    tabHome: 'Home',
    tabSearch: 'Cerca',
    tabDownloads: 'Download',
    tabWatchlist: 'Preferiti',
    tabSettings: 'Opzioni',

    // Home
    continueWatching: 'Continua a guardare',
    completed: 'completato',
    browseGenres: 'Esplora per genere',
    noContent: 'Nessun contenuto disponibile',

    // Search
    searchPlaceholder: 'Cerca film, serie tv, attori...',
    searchBtn: 'Cerca',
    filterAll: 'Tutti',
    filterMovies: 'Solo Film',
    filterSeries: 'Solo Serie',
    searchPrompt: 'Inserisci un termine di ricerca o seleziona un genere.',
    searching: 'Ricerca in corso...',

    // Downloads
    inProgress: 'In corso',
    localLibrary: 'Libreria Locale',
    noActiveDownloads: 'Nessun download attivo in coda.',
    noLocalFiles: 'Nessun file scaricato nell archivio.',
    cancel: 'Annulla',
    play: 'Riproduci',

    // Watchlist
    watchlistHeader: 'I tuoi Preferiti',
    noWatchlist: 'Nessun titolo salvato nei preferiti.',
    saveToWatchlist: 'Salva nei Preferiti',
    removeFromWatchlist: 'Rimuovi dai Preferiti',

    // Detail Modal
    close: 'Chiudi',
    movie: 'Film',
    tvShow: 'Serie TV',
    minutes: 'minuti',
    noPlot: 'Nessuna trama disponibile.',
    audioTracks: 'Tracce Audio',
    italian: 'Italiano',
    originalEng: 'Originale / ENG',
    streamPlay: 'Riproduci (Streaming)',
    download: 'Download',
    seasons: 'Stagioni',
    seasonPrefix: 'Stagione ',
    episodes: 'Episodi',
    episodePrefix: 'Episodio ',

    // Settings
    serverConnection: 'Connessione Server',
    currentServerUrl: 'URL Server Attuale',
    testConnection: 'Test Connessione',
    accountManagement: 'Gestione Server',
    disconnectServer: 'Disconnetti e Cambia Server',
    appPreferences: 'Preferenze Applicazione',
    language: 'Lingua',
    langEn: 'English',
    langIt: 'Italiano',
  }
};

const GENRES = {
  en: [
    'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
    'Documentary', 'Drama', 'Family', 'Fantasy', 'Sci-Fi',
    'Horror', 'Mystery', 'Romance', 'Thriller', 'Western', 'War'
  ],
  it: [
    'Azione', 'Avventura', 'Animazione', 'Commedia', 'Crime',
    'Documentario', 'Dramma', 'Famiglia', 'Fantasy', 'Fantascienza',
    'Horror', 'Mistero', 'Romantico', 'Thriller', 'Western', 'Guerra'
  ]
};

function MainApp() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  // Language state (default 'en')
  const [lang, setLang] = useState('en');
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
  const genresList = GENRES[lang] || GENRES.en;

  // Server & Connection State
  const [serverUrl, setServerUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [connStatus, setConnStatus] = useState('checking'); // 'checking' | 'connected' | 'disconnected' | 'error'
  const [errorMessage, setErrorMessage] = useState('');

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

  const changeLanguage = async (newLang) => {
    setLang(newLang);
    try {
      await AsyncStorage.setItem('@aurafilm_lang', newLang);
    } catch (e) {
      console.error(e);
    }
  };

  const initApp = async () => {
    try {
      const savedLang = await AsyncStorage.getItem('@aurafilm_lang');
      if (savedLang) {
        setLang(savedLang);
      }
      const savedUrl = await AsyncStorage.getItem('@aurafilm_url');
      if (savedUrl) {
        setServerUrl(savedUrl);
        setInputUrl(savedUrl);
        await testAndLoad(savedUrl);
      } else {
        setConnStatus('disconnected');
      }
    } catch (e) {
      console.error(e);
      setConnStatus('disconnected');
    } finally {
      setIsLoading(false);
    }
  };

  const testAndLoad = async (url) => {
    setIsRefreshing(true);
    setErrorMessage('');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${url}/api/status`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        setConnStatus('connected');
        loadHomeData(url);
      } else {
        setConnStatus('error');
        setErrorMessage(`HTTP ${res.status}`);
      }
    } catch (e) {
      setConnStatus('error');
      setErrorMessage(e.message || 'Connection error or timeout');
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
      const parts = finalUrl.split('://');
      const proto = parts[0];
      const hostPart = parts[1];
      if (hostPart && !hostPart.includes(':') && hostPart.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        finalUrl = `${proto}://${hostPart}:8080`;
      }
    } catch (e) {}

    setInputUrl(finalUrl);

    try {
      await AsyncStorage.setItem('@aurafilm_url', finalUrl);
      setServerUrl(finalUrl);
      await testAndLoad(finalUrl);
    } catch (e) {
      console.error(e);
    }
  };

  const disconnectServer = async () => {
    await AsyncStorage.removeItem('@aurafilm_url');
    setServerUrl('');
    setShelves([]);
    setHistory([]);
    setConnStatus('disconnected');
    setCurrentTab('settings');
  };

  // Home Data - robust extraction of .shelves and .history
  const loadHomeData = async (url = serverUrl) => {
    if (!url) return;
    setIsRefreshing(true);
    try {
      const [shelvesRes, historyRes] = await Promise.all([
        fetch(`${url}/api/shelves`),
        fetch(`${url}/api/history`).catch(() => ({ ok: false }))
      ]);

      if (shelvesRes.ok) {
        const shelvesData = await shelvesRes.json();
        const list = Array.isArray(shelvesData)
          ? shelvesData
          : (shelvesData && Array.isArray(shelvesData.shelves) ? shelvesData.shelves : []);
        setShelves(list);
      }
      if (historyRes && historyRes.ok) {
        const historyData = await historyRes.json();
        const list = Array.isArray(historyData)
          ? historyData
          : (historyData && Array.isArray(historyData.history) ? historyData.history : []);
        setHistory(list);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Search - robust extraction of .results
  const handleSearch = async (query = searchQuery, type = searchType) => {
    if (!query.trim() || !serverUrl) return;
    setIsSearching(true);
    try {
      let endpoint = `${serverUrl}/api/search?q=${encodeURIComponent(query)}`;
      if (type) endpoint += `&type=${type}`;
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : (data && Array.isArray(data.results) ? data.results : []);
        setSearchResults(list);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  // Downloads & Files - robust extraction of .jobs and .files
  const loadDownloads = async () => {
    if (!serverUrl) return;
    try {
      const [jobsRes, filesRes] = await Promise.all([
        fetch(`${serverUrl}/api/jobs`),
        fetch(`${serverUrl}/api/files`)
      ]);
      if (jobsRes.ok) {
        const j = await jobsRes.json();
        const list = Array.isArray(j)
          ? j
          : (j && Array.isArray(j.jobs) ? j.jobs : []);
        setActiveJobs(list);
      }
      if (filesRes.ok) {
        const f = await filesRes.json();
        const list = Array.isArray(f)
          ? f
          : (f && Array.isArray(f.files) ? f.files : []);
        setLibraryFiles(list);
      }
    } catch (e) {
      console.error(e);
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

  // Watchlist - robust extraction of .watchlist
  const loadWatchlist = async () => {
    if (!serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}/api/watchlist`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : (data && Array.isArray(data.watchlist) ? data.watchlist : []);
        setWatchlist(list);
      }
    } catch (e) {
      console.error(e);
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
          slug: item.slug,
          name: item.name,
          type: item.type,
          poster: item.poster,
          year: item.year,
        })
      });
      loadWatchlist();
    } catch (e) {
      console.error(e);
    }
  };

  // Details Modal - robust extraction of .title and .episodes
  const openTitleDetails = async (id, slug) => {
    if (!serverUrl) return;
    setDetailLoading(true);
    setSelectedTitle(null);
    setSelectedSeason(1);
    setSeasonEpisodes([]);

    try {
      const res = await fetch(`${serverUrl}/api/title/${id}/${slug}`);
      if (res.ok) {
        const data = await res.json();
        const titleObj = data && data.title ? data.title : data;
        setSelectedTitle(titleObj);
        if (titleObj && titleObj.type === 'tv' && Array.isArray(titleObj.seasons) && titleObj.seasons.length > 0) {
          const firstSeason = titleObj.seasons[0].number || 1;
          setSelectedSeason(firstSeason);
          loadEpisodes(id, slug, firstSeason);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  };

  const loadEpisodes = async (id, slug, seasonNum) => {
    try {
      const res = await fetch(`${serverUrl}/api/title/${id}/${slug}/season/${seasonNum}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : (data && Array.isArray(data.episodes) ? data.episodes : []);
        setSeasonEpisodes(list);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const startDownloadMovie = async () => {
    if (!selectedTitle || !serverUrl) return;
    try {
      const audio = [];
      if (audioIta) audio.push('ita');
      if (audioEng) audio.push('eng');

      const res = await fetch(`${serverUrl}/api/jobs/movie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedTitle.id,
          slug: selectedTitle.slug,
          name: selectedTitle.name,
          year: selectedTitle.year,
          poster: selectedTitle.poster,
          audio,
        })
      });
      if (res.ok) {
        setSelectedTitle(null);
        setCurrentTab('downloads');
        loadDownloads();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const startDownloadEpisode = async (ep) => {
    if (!selectedTitle || !serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}/api/jobs/episode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedTitle.id,
          slug: selectedTitle.slug,
          name: selectedTitle.name,
          season: selectedSeason,
          episode: ep.number,
          episode_id: ep.id,
          poster: selectedTitle.poster,
          audio: ['ita'],
        })
      });
      if (res.ok) {
        setSelectedTitle(null);
        setCurrentTab('downloads');
        loadDownloads();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Streaming Player
  const playStream = (streamUrl, title) => {
    setPlayerUrl(streamUrl);
    setPlayerTitle(title);
    setPlayerVisible(true);
  };

  // Grid / Shelf item card dimensions
  const cardWidth = isTablet ? 150 : 110;
  const cardHeight = Math.round(cardWidth * 1.5);

  const renderMediaCard = (item) => {
    if (!item) return null;
    const posterUri = item.poster ? `${serverUrl}/api/image/${item.poster}` : null;
    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.mediaCard, { width: cardWidth }]}
        onPress={() => openTitleDetails(item.id, item.slug)}
        activeOpacity={0.8}
      >
        <View style={[styles.posterWrap, { width: cardWidth, height: cardHeight }]}>
          {posterUri ? (
            <Image source={{ uri: posterUri }} style={styles.posterImg} resizeMode="cover" />
          ) : (
            <View style={styles.posterPlaceholder}>
              <Text style={styles.posterPlaceholderText}>AuraFilm</Text>
            </View>
          )}
          {item.score ? (
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreText}>{item.score}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.cardMeta}>{item.year || ''} • {item.type === 'tv' ? t.tvShow : t.movie}</Text>
      </TouchableOpacity>
    );
  };

  // Fullscreen HTML5 / HLS Player template
  const getPlayerHtml = () => `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; background: #000; }
        body, html { width: 100%; height: 100%; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        video { width: 100%; height: 100%; object-fit: contain; }
      </style>
      <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    </head>
    <body>
      <video id="player" controls autoplay playsinline webkit-playsinline></video>
      <script>
        const video = document.getElementById('player');
        const streamUrl = "${playerUrl}";

        if (Hls.isSupported() && (streamUrl.includes('.m3u8') || streamUrl.includes('/stream/'))) {
          const hls = new Hls({
            startLevel: -1,
            capLevelToPlayerSize: false,
            autoStartLoad: true
          });
          hls.loadSource(streamUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
            if (data.levels && data.levels.length > 0) {
              hls.currentLevel = data.levels.length - 1;
            }
            video.play().catch(function(e) {});
          });
        } else {
          video.src = streamUrl;
          video.play().catch(function(e) {});
        }
      </script>
    </body>
    </html>
  `;

  // Loading Screen
  if (isLoading) {
    return (
      <View style={styles.splashScreen}>
        <ActivityIndicator size="large" color="#00d2ff" />
        <Text style={styles.splashText}>AuraFilm</Text>
      </View>
    );
  }

  // Setup Server Screen
  if (!serverUrl || connStatus === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />
        <View style={styles.setupCard}>
          {/* Language selector in setup header */}
          <View style={styles.setupLangHeader}>
            <TouchableOpacity
              style={[styles.setupLangBtn, lang === 'en' && styles.setupLangBtnActive]}
              onPress={() => changeLanguage('en')}
            >
              <Text style={[styles.setupLangText, lang === 'en' && styles.setupLangTextActive]}>EN</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.setupLangBtn, lang === 'it' && styles.setupLangBtnActive]}
              onPress={() => changeLanguage('it')}
            >
              <Text style={[styles.setupLangText, lang === 'it' && styles.setupLangTextActive]}>IT</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.setupBrand}>{t.appTitle}</Text>
          <Text style={styles.setupTagline}>{t.setupTagline}</Text>

          <Text style={styles.inputLabel}>{t.serverAddressLabel}</Text>
          <TextInput
            style={styles.textInput}
            value={inputUrl}
            onChangeText={setInputUrl}
            placeholder={t.serverAddressPlaceholder}
            placeholderTextColor="#4a5568"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {connStatus === 'error' ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorBanner}>{t.connectionError}</Text>
              {errorMessage ? (
                <Text style={styles.errorDetail}>{t.errorDetailPrefix}{errorMessage}</Text>
              ) : null}
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, isRefreshing && { opacity: 0.6 }]}
            onPress={saveUrl}
            disabled={isRefreshing}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>
              {isRefreshing ? t.connecting : t.connectServer}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Main App Shell
  const isInWatchlist = selectedTitle && Array.isArray(watchlist) && watchlist.some(w => w.id === selectedTitle.id);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.brandTitle}>{t.appTitle}</Text>
          <Text style={styles.brandSubtitle}>{t.appSubtitle}</Text>
        </View>
        <View style={styles.serverStatusTag}>
          <View style={[styles.statusDot, { backgroundColor: connStatus === 'connected' ? '#00e676' : '#ff5252' }]} />
          <Text style={styles.serverStatusText}>{connStatus === 'connected' ? t.online : t.offline}</Text>
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
            {/* Continue Watching */}
            {Array.isArray(history) && history.length > 0 && (
              <View style={styles.sectionWrap}>
                <Text style={styles.sectionHeader}>{t.continueWatching}</Text>
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
                        <Text style={styles.cardMeta}>{percent}% {t.completed}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Standard Shelves */}
            {(Array.isArray(shelves) ? shelves : []).map(shelf => (
              <View key={shelf.key || shelf.label} style={styles.sectionWrap}>
                <Text style={styles.sectionHeader}>{shelf.label || shelf.key}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowPadding}>
                  {(Array.isArray(shelf.items) ? shelf.items : []).map(item => renderMediaCard(item))}
                </ScrollView>
              </View>
            ))}

            {/* Genres Section */}
            <View style={styles.genreSectionWrap}>
              <Text style={styles.sectionHeader}>{t.browseGenres}</Text>
              <View style={styles.genreChipsRow}>
                {genresList.map(g => (
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
                placeholder={t.searchPlaceholder}
                placeholderTextColor="#64748b"
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={() => handleSearch()}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.searchSubmitBtn} onPress={() => handleSearch()}>
                <Text style={styles.searchSubmitText}>{t.searchBtn}</Text>
              </TouchableOpacity>
            </View>

            {/* Type filters */}
            <View style={styles.typeFilterRow}>
              <TouchableOpacity
                style={[styles.filterChip, searchType === null && styles.filterChipActive]}
                onPress={() => { setSearchType(null); handleSearch(searchQuery, null); }}
              >
                <Text style={[styles.filterChipText, searchType === null && styles.filterChipTextActive]}>{t.filterAll}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, searchType === 'movie' && styles.filterChipActive]}
                onPress={() => { setSearchType('movie'); handleSearch(searchQuery, 'movie'); }}
              >
                <Text style={[styles.filterChipText, searchType === 'movie' && styles.filterChipTextActive]}>{t.filterMovies}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, searchType === 'tv' && styles.filterChipActive]}
                onPress={() => { setSearchType('tv'); handleSearch(searchQuery, 'tv'); }}
              >
                <Text style={[styles.filterChipText, searchType === 'tv' && styles.filterChipTextActive]}>{t.filterSeries}</Text>
              </TouchableOpacity>
            </View>

            {isSearching ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color="#00d2ff" />
                <Text style={styles.dimmedText}>{t.searching}</Text>
              </View>
            ) : (
              <FlatList
                data={Array.isArray(searchResults) ? searchResults : []}
                keyExtractor={(item) => (item.id ? item.id.toString() : Math.random().toString())}
                numColumns={isTablet ? 5 : 3}
                contentContainerStyle={styles.gridContent}
                renderItem={({ item }) => renderMediaCard(item)}
                ListEmptyComponent={
                  <View style={styles.centerBox}>
                    <Text style={styles.dimmedText}>{t.searchPrompt}</Text>
                  </View>
                }
              />
            )}
          </View>
        )}

        {/* 3. DOWNLOADS TAB */}
        {currentTab === 'downloads' && (
          <View style={styles.tabContainer}>
            <View style={styles.subTabHeader}>
              <TouchableOpacity
                style={[styles.subTabBtn, downloadsTab === 'jobs' && styles.subTabBtnActive]}
                onPress={() => { setDownloadsTab('jobs'); loadDownloads(); }}
              >
                <Text style={[styles.subTabText, downloadsTab === 'jobs' && styles.subTabTextActive]}>
                  {t.inProgress} ({activeJobs.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subTabBtn, downloadsTab === 'files' && styles.subTabBtnActive]}
                onPress={() => { setDownloadsTab('files'); loadDownloads(); }}
              >
                <Text style={[styles.subTabText, downloadsTab === 'files' && styles.subTabTextActive]}>
                  {t.localLibrary} ({libraryFiles.length})
                </Text>
              </TouchableOpacity>
            </View>

            {downloadsTab === 'jobs' ? (
              <FlatList
                data={Array.isArray(activeJobs) ? activeJobs : []}
                keyExtractor={(item) => item.id || Math.random().toString()}
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
                          <Text style={styles.cancelText}>{t.cancel}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                )}
                ListEmptyComponent={
                  <View style={styles.centerBox}>
                    <Text style={styles.dimmedText}>{t.noActiveDownloads}</Text>
                  </View>
                }
              />
            ) : (
              <FlatList
                data={Array.isArray(libraryFiles) ? libraryFiles : []}
                keyExtractor={(item) => item.path || Math.random().toString()}
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
                      <Text style={styles.playFileBtnText}>{t.play}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                ListEmptyComponent={
                  <View style={styles.centerBox}>
                    <Text style={styles.dimmedText}>{t.noLocalFiles}</Text>
                  </View>
                }
              />
            )}
          </View>
        )}

        {/* 4. WATCHLIST TAB */}
        {currentTab === 'watchlist' && (
          <View style={styles.tabContainer}>
            <View style={styles.headerPad}>
              <Text style={styles.sectionHeader}>{t.watchlistHeader}</Text>
            </View>
            <FlatList
              data={Array.isArray(watchlist) ? watchlist : []}
              keyExtractor={(item) => (item.id ? item.id.toString() : Math.random().toString())}
              numColumns={isTablet ? 5 : 3}
              contentContainerStyle={styles.gridContent}
              renderItem={({ item }) => renderMediaCard(item)}
              ListEmptyComponent={
                <View style={styles.centerBox}>
                  <Text style={styles.dimmedText}>{t.noWatchlist}</Text>
                </View>
              }
            />
          </View>
        )}

        {/* 5. SETTINGS TAB */}
        {currentTab === 'settings' && (
          <ScrollView style={styles.scrollArea}>
            <View style={styles.settingsWrapper}>
              {/* Language Selection */}
              <View style={styles.settingsSection}>
                <Text style={styles.settingGroupTitle}>{t.appPreferences}</Text>
                <Text style={styles.settingLabel}>{t.language}</Text>
                <View style={styles.langPickerRow}>
                  <TouchableOpacity
                    style={[styles.langChip, lang === 'en' && styles.langChipActive]}
                    onPress={() => changeLanguage('en')}
                  >
                    <Text style={[styles.langChipText, lang === 'en' && styles.langChipTextActive]}>
                      {t.langEn}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.langChip, lang === 'it' && styles.langChipActive]}
                    onPress={() => changeLanguage('it')}
                  >
                    <Text style={[styles.langChipText, lang === 'it' && styles.langChipTextActive]}>
                      {t.langIt}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Server Connection */}
              <View style={styles.settingsSection}>
                <Text style={styles.settingGroupTitle}>{t.serverConnection}</Text>
                <Text style={styles.settingLabel}>{t.currentServerUrl}</Text>
                <Text style={styles.settingValue}>{serverUrl}</Text>
                <TouchableOpacity
                  style={[styles.primaryBtn, { marginTop: 12 }]}
                  onPress={() => testAndLoad(serverUrl)}
                >
                  <Text style={styles.primaryBtnText}>{t.testConnection}</Text>
                </TouchableOpacity>
              </View>

              {/* Server Management */}
              <View style={styles.settingsSection}>
                <Text style={styles.settingGroupTitle}>{t.accountManagement}</Text>
                <TouchableOpacity style={styles.dangerBtn} onPress={disconnectServer}>
                  <Text style={styles.dangerBtnText}>{t.disconnectServer}</Text>
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
          <Text style={[styles.navBtnText, currentTab === 'home' && styles.navBtnTextActive]}>{t.tabHome}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, currentTab === 'search' && styles.navBtnActive]}
          onPress={() => setCurrentTab('search')}
        >
          <Text style={[styles.navBtnText, currentTab === 'search' && styles.navBtnTextActive]}>{t.tabSearch}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, currentTab === 'downloads' && styles.navBtnActive]}
          onPress={() => { setCurrentTab('downloads'); loadDownloads(); }}
        >
          <Text style={[styles.navBtnText, currentTab === 'downloads' && styles.navBtnTextActive]}>{t.tabDownloads}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, currentTab === 'watchlist' && styles.navBtnActive]}
          onPress={() => { setCurrentTab('watchlist'); loadWatchlist(); }}
        >
          <Text style={[styles.navBtnText, currentTab === 'watchlist' && styles.navBtnTextActive]}>{t.tabWatchlist}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, currentTab === 'settings' && styles.navBtnActive]}
          onPress={() => setCurrentTab('settings')}
        >
          <Text style={[styles.navBtnText, currentTab === 'settings' && styles.navBtnTextActive]}>{t.tabSettings}</Text>
        </TouchableOpacity>
      </View>

      {/* Title Details Modal */}
      <Modal visible={!!selectedTitle || detailLoading} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.modalContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />
          {detailLoading || !selectedTitle ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color="#00d2ff" />
              <Text style={styles.dimmedText}>{t.searching}</Text>
            </View>
          ) : (
            <ScrollView style={styles.scrollArea}>
              <View style={styles.detailHeader}>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedTitle(null)}>
                  <Text style={styles.closeBtnText}>{t.close}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.favBtn}
                  onPress={() => toggleWatchlist(selectedTitle)}
                >
                  <Text style={styles.favBtnText}>
                    {isInWatchlist ? t.removeFromWatchlist : t.saveToWatchlist}
                  </Text>
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
                      {selectedTitle.year || ''} • {selectedTitle.type === 'tv' ? t.tvShow : t.movie}
                      {selectedTitle.score ? ` • ${selectedTitle.score}` : ''}
                    </Text>
                    {selectedTitle.runtime ? (
                      <Text style={styles.detailRuntime}>{selectedTitle.runtime} {t.minutes}</Text>
                    ) : null}
                  </View>
                </View>

                <Text style={styles.plotText}>{selectedTitle.plot || t.noPlot}</Text>

                {/* Movie Actions */}
                {selectedTitle.type === 'movie' ? (
                  <View style={styles.actionsPanel}>
                    <Text style={styles.panelTitle}>{t.audioTracks}</Text>
                    <View style={styles.audioOptions}>
                      <TouchableOpacity
                        style={[styles.audioToggle, audioIta && styles.audioToggleActive]}
                        onPress={() => setAudioIta(!audioIta)}
                      >
                        <Text style={[styles.audioToggleText, audioIta && styles.audioToggleTextActive]}>{t.italian}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.audioToggle, audioEng && styles.audioToggleActive]}
                        onPress={() => setAudioEng(!audioEng)}
                      >
                        <Text style={[styles.audioToggleText, audioEng && styles.audioToggleTextActive]}>{t.originalEng}</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.actionButtonsRow}>
                      <TouchableOpacity
                        style={styles.primaryActionBtn}
                        onPress={() => playStream(`${serverUrl}/api/stream/proxy/${selectedTitle.id}/${selectedTitle.slug}`, selectedTitle.name)}
                      >
                        <Text style={styles.primaryActionText}>{t.streamPlay}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.secondaryActionBtn} onPress={startDownloadMovie}>
                        <Text style={styles.secondaryActionText}>{t.download}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  /* TV Series Actions */
                  <View style={styles.actionsPanel}>
                    <Text style={styles.panelTitle}>{t.seasons}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 10 }}>
                      {(Array.isArray(selectedTitle.seasons) ? selectedTitle.seasons : []).map(s => (
                        <TouchableOpacity
                          key={s.number}
                          style={[styles.seasonChip, selectedSeason === s.number && styles.seasonChipActive]}
                          onPress={() => {
                            setSelectedSeason(s.number);
                            loadEpisodes(selectedTitle.id, selectedTitle.slug, s.number);
                          }}
                        >
                          <Text style={[styles.seasonChipText, selectedSeason === s.number && styles.seasonChipTextActive]}>
                            {t.seasonPrefix}{s.number}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    <Text style={[styles.panelTitle, { marginTop: 16 }]}>{t.episodes}</Text>
                    {(Array.isArray(seasonEpisodes) ? seasonEpisodes : []).map(ep => (
                      <View key={ep.id} style={styles.episodeCard}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={styles.episodeTitle}>E{ep.number} - {ep.name || `${t.episodePrefix}${ep.number}`}</Text>
                          {ep.duration ? <Text style={styles.episodeDuration}>{ep.duration} min</Text> : null}
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <TouchableOpacity
                            style={styles.epPlayBtn}
                            onPress={() => playStream(`${serverUrl}/api/stream/proxy/${selectedTitle.id}/${selectedTitle.slug}?episode_id=${ep.id}`, `${selectedTitle.name} S${selectedSeason}E${ep.number}`)}
                          >
                            <Text style={styles.epPlayText}>{t.play}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.epDlBtn} onPress={() => startDownloadEpisode(ep)}>
                            <Text style={styles.epDlText}>{t.download}</Text>
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

      {/* Fullscreen Video Player Modal */}
      <Modal visible={playerVisible} animationType="fade" transparent={false}>
        <SafeAreaView style={styles.playerContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#000000" />
          <View style={styles.playerHeader}>
            <Text style={styles.playerHeaderTitle} numberOfLines={1}>{playerTitle}</Text>
            <TouchableOpacity style={styles.playerCloseBtn} onPress={() => setPlayerUrl('') || setPlayerVisible(false)}>
              <Text style={styles.playerCloseText}>{t.close}</Text>
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

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}

// Stylesheet
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f19' },
  splashScreen: { flex: 1, backgroundColor: '#0b0f19', justifyContent: 'center', alignItems: 'center' },
  splashText: { color: '#00d2ff', marginTop: 14, fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30, minHeight: 250 },
  dimmedText: { color: '#64748b', fontSize: 15, marginTop: 10, textAlign: 'center' },

  // Setup Screen
  setupCard: { flex: 1, justifyContent: 'center', padding: 28 },
  setupLangHeader: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 20 },
  setupLangBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4, borderWidth: 1, borderColor: '#1e293b' },
  setupLangBtnActive: { backgroundColor: '#00d2ff', borderColor: '#00d2ff' },
  setupLangText: { color: '#64748b', fontSize: 11, fontWeight: '700' },
  setupLangTextActive: { color: '#0b0f19' },
  setupBrand: { fontSize: 36, fontWeight: '800', color: '#00d2ff', textAlign: 'center', letterSpacing: 0.5 },
  setupTagline: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginTop: 8, marginBottom: 36 },
  inputLabel: { color: '#cbd5e1', fontSize: 13, marginBottom: 8, fontWeight: '600' },
  textInput: { backgroundColor: '#131b2e', borderWidth: 1, borderColor: '#1e293b', borderRadius: 8, color: '#f8fafc', padding: 14, fontSize: 15, marginBottom: 16 },
  primaryBtn: { backgroundColor: '#00d2ff', padding: 15, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#0b0f19', fontSize: 15, fontWeight: '700' },
  errorBox: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 1, borderColor: '#ef4444', borderRadius: 8, padding: 12, marginBottom: 16 },
  errorBanner: { color: '#f87171', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  errorDetail: { color: '#fca5a5', fontSize: 11, textAlign: 'center', marginTop: 6, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

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
  sectionHeader: { fontSize: 18, fontWeight: '800', color: '#f8fafc', paddingHorizontal: 16, marginBottom: 12, letterSpacing: 0.3 },
  rowPadding: { paddingHorizontal: 16, gap: 12 },
  mediaCard: { marginRight: 12 },
  posterWrap: { borderRadius: 8, overflow: 'hidden', backgroundColor: '#1e293b', position: 'relative' },
  posterImg: { width: '100%', height: '100%' },
  posterPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#131b2e' },
  posterPlaceholderText: { color: '#334155', fontWeight: '800', fontSize: 12 },
  scoreBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(11, 15, 25, 0.85)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  scoreText: { color: '#00d2ff', fontSize: 10, fontWeight: '800' },
  cardTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '600', marginTop: 8 },
  cardMeta: { color: '#64748b', fontSize: 11, marginTop: 2 },

  // History Card
  historyCard: { marginRight: 12 },
  historyBarWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.6)' },
  historyBarFill: { height: '100%', backgroundColor: '#00d2ff' },

  // Genre Section
  genreSectionWrap: { marginTop: 28, paddingHorizontal: 16 },
  genreChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  genreChip: { backgroundColor: '#131b2e', borderWidth: 1, borderColor: '#1e293b', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  genreChipText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },

  // Search Screen
  searchBarWrap: { flexDirection: 'row', padding: 16, gap: 10 },
  searchInput: { flex: 1, backgroundColor: '#131b2e', borderWidth: 1, borderColor: '#1e293b', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, color: '#f8fafc', fontSize: 14 },
  searchSubmitBtn: { backgroundColor: '#00d2ff', borderRadius: 8, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center' },
  searchSubmitText: { color: '#0b0f19', fontWeight: '700', fontSize: 13 },
  typeFilterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  filterChip: { backgroundColor: '#131b2e', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#1e293b' },
  filterChipActive: { backgroundColor: '#1e293b', borderColor: '#00d2ff' },
  filterChipText: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#00d2ff' },
  gridContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 16 },

  // Downloads Screen
  subTabHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  subTabBtn: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  subTabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#00d2ff' },
  subTabText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  subTabTextActive: { color: '#00d2ff' },
  listContent: { padding: 16, gap: 12 },
  jobItemCard: { backgroundColor: '#131b2e', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#1e293b' },
  jobRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  jobName: { color: '#f8fafc', fontSize: 14, fontWeight: '600', flex: 1, marginRight: 10 },
  jobPercent: { color: '#00d2ff', fontSize: 13, fontWeight: '700' },
  progressBar: { height: 6, backgroundColor: '#1e293b', borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: '#00d2ff' },
  jobFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobPhase: { color: '#64748b', fontSize: 12, textTransform: 'capitalize' },
  cancelText: { color: '#ef4444', fontSize: 12, fontWeight: '600' },
  fileItemCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#131b2e', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#1e293b' },
  fileName: { color: '#f8fafc', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  fileSize: { color: '#64748b', fontSize: 11 },
  playFileBtn: { backgroundColor: '#00d2ff', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  playFileBtnText: { color: '#0b0f19', fontSize: 12, fontWeight: '700' },

  // Watchlist Header
  headerPad: { padding: 16 },

  // Settings Screen
  settingsWrapper: { padding: 16, gap: 20 },
  settingsSection: { backgroundColor: '#131b2e', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#1e293b' },
  settingGroupTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700', marginBottom: 12 },
  settingLabel: { color: '#64748b', fontSize: 12, marginBottom: 4 },
  settingValue: { color: '#cbd5e1', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', marginBottom: 6 },
  dangerBtn: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 1, borderColor: '#ef4444', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  dangerBtnText: { color: '#ef4444', fontSize: 14, fontWeight: '700' },
  langPickerRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  langChip: { flex: 1, backgroundColor: '#0b0f19', borderWidth: 1, borderColor: '#1e293b', paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
  langChipActive: { borderColor: '#00d2ff', backgroundColor: 'rgba(0, 210, 255, 0.1)' },
  langChipText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  langChipTextActive: { color: '#00d2ff' },

  // Bottom Navigation
  bottomNav: { flexDirection: 'row', backgroundColor: '#0b0f19', borderTopWidth: 1, borderTopColor: '#1e293b', height: 60, alignItems: 'center' },
  navBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
