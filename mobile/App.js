import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, TextInput, TouchableOpacity, 
  SafeAreaView, StatusBar, KeyboardAvoidingView, Platform, 
  FlatList, Image, ScrollView, ActivityIndicator
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function App() {
  const [serverUrl, setServerUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  
  // App State
  const [shelves, setShelves] = useState([]);
  const [isFetching, setIsFetching] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    loadSavedUrl();
  }, []);

  const loadSavedUrl = async () => {
    try {
      const saved = await AsyncStorage.getItem('@aurafilm_url');
      if (saved) {
        setServerUrl(saved);
        setInputUrl(saved);
        fetchData(saved);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const saveUrl = async () => {
    let finalUrl = inputUrl.trim();
    if (!finalUrl) return;
    if (!finalUrl.startsWith('http')) finalUrl = 'http://' + finalUrl;
    if (finalUrl.endsWith('/')) finalUrl = finalUrl.slice(0, -1);
    
    try {
      await AsyncStorage.setItem('@aurafilm_url', finalUrl);
      setServerUrl(finalUrl);
      fetchData(finalUrl);
    } catch (e) {
      console.error(e);
    }
  };

  const resetUrl = async () => {
    try {
      await AsyncStorage.removeItem('@aurafilm_url');
      setServerUrl('');
      setShelves([]);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchData = async (url) => {
    setIsFetching(true);
    setErrorMsg('');
    try {
      const response = await fetch(`${url}/api/shelves`);
      if (!response.ok) throw new Error('Server non raggiungibile');
      const data = await response.json();
      if (data.shelves) setShelves(data.shelves);
    } catch (err) {
      setErrorMsg('Impossibile connettersi al server. Verifica l\'URL.');
      console.error(err);
    } finally {
      setIsFetching(false);
    }
  };

  const renderMovie = ({ item }) => (
    <View style={styles.movieCard}>
      <Image 
        source={{ uri: `${serverUrl}/api/image/${item.images.poster}` }} 
        style={styles.moviePoster}
        resizeMode="cover"
      />
      <View style={styles.movieInfo}>
        <Text style={styles.movieTitle} numberOfLines={1}>{item.name}</Text>
        <View style={styles.movieMetaRow}>
          <Text style={styles.movieMeta}>{item.year || '2024'} • {item.type === 'movie' ? 'Film' : 'Serie'}</Text>
          {item.score && <Text style={styles.movieScore}>⭐ {item.score}</Text>}
        </View>
      </View>
    </View>
  );

  const renderShelf = (shelf) => (
    <View key={shelf.title} style={styles.shelfContainer}>
      <Text style={styles.shelfTitle}>{shelf.title}</Text>
      <FlatList
        horizontal
        data={shelf.items}
        renderItem={renderMovie}
        keyExtractor={(item) => item.id.toString()}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16 }}
      />
    </View>
  );

  if (isLoading) {
    return <View style={styles.container}><ActivityIndicator size="large" color="#00d2ff" /></View>;
  }

  // SCHERMATA SETUP SERVER
  if (!serverUrl || errorMsg) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0d14" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.setupContainer}>
          <Text style={styles.title}>🎬 AuraFilm</Text>
          <Text style={styles.subtitle}>Connettiti al tuo Server (App Nativa)</Text>
          
          <Text style={styles.label}>Indirizzo del server (es. 192.168.1.45:8080)</Text>
          <TextInput
            style={styles.input}
            placeholder="http://192.168.1.x:8080"
            placeholderTextColor="#555"
            value={inputUrl}
            onChangeText={setInputUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          <TouchableOpacity style={styles.button} onPress={saveUrl}>
            <Text style={styles.buttonText}>Connetti e Sincronizza</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // SCHERMATA HOME (NATIVA)
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0d14" />
      
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🎬 AuraFilm</Text>
        <TouchableOpacity onPress={resetUrl} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>Disconnetti</Text>
        </TouchableOpacity>
      </View>

      {/* CONTENUTO */}
      {isFetching ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#00d2ff" />
          <Text style={styles.loadingText}>Sincronizzazione catalogo...</Text>
        </View>
      ) : (
        <ScrollView style={styles.scrollView}>
          {shelves.length === 0 ? (
            <View style={styles.centerContainer}>
              <Text style={styles.emptyText}>Nessun contenuto trovato.</Text>
            </View>
          ) : (
            shelves.map(shelf => renderShelf(shelf))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0d14' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 50 },
  setupContainer: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#00d2ff', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#8c9cb8', textAlign: 'center', marginBottom: 40 },
  label: { color: '#f0f4fc', fontSize: 14, marginBottom: 8, fontWeight: '600' },
  input: { backgroundColor: '#161d2d', borderWidth: 1, borderColor: '#242f47', borderRadius: 10, color: '#fff', padding: 14, fontSize: 16, marginBottom: 16 },
  errorText: { color: '#ff4444', marginBottom: 16, textAlign: 'center' },
  button: { backgroundColor: '#00d2ff', padding: 16, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#000', fontSize: 16, fontWeight: 'bold' },
  
  // Native UI Styles
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#161d2d' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  headerBtn: { padding: 8, backgroundColor: '#161d2d', borderRadius: 6 },
  headerBtnText: { color: '#8c9cb8', fontSize: 12 },
  scrollView: { flex: 1 },
  loadingText: { color: '#8c9cb8', marginTop: 12 },
  emptyText: { color: '#8c9cb8', fontSize: 16 },
  
  // Shelf & Cards
  shelfContainer: { marginTop: 24, paddingBottom: 8 },
  shelfTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginLeft: 16, marginBottom: 16 },
  movieCard: { width: 140, marginRight: 16, backgroundColor: '#161d2d', borderRadius: 12, overflow: 'hidden' },
  moviePoster: { width: 140, height: 210, backgroundColor: '#242f47' },
  movieInfo: { padding: 10 },
  movieTitle: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  movieMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  movieMeta: { color: '#8c9cb8', fontSize: 11 },
  movieScore: { color: '#f5c518', fontSize: 11, fontWeight: 'bold' }
});
