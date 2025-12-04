require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Priority countries (French-speaking)
const PRIORITY_COUNTRIES = ['FR', 'BE', 'CH', 'LU', 'CA'];
const FRENCH_SPEAKING_COUNTRIES = ['FR', 'BE', 'CH', 'LU', 'CA', 'MC', 'SN', 'CI', 'ML', 'MG', 'CM', 'HT'];

// Initialize database
async function initDatabase() {
  try {
    const tableCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'availabilities' AND column_name = 'addon_name'
    `);
    
    if (tableCheck.rows.length === 0) {
      await pool.query(`DROP TABLE IF EXISTS availabilities`);
      await pool.query(`
        CREATE TABLE availabilities (
          id SERIAL PRIMARY KEY,
          tmdb_id INTEGER NOT NULL,
          platform VARCHAR(100) NOT NULL,
          country_code VARCHAR(10) NOT NULL,
          country_name VARCHAR(100) NOT NULL,
          streaming_type VARCHAR(20) NOT NULL DEFAULT 'subscription',
          addon_name VARCHAR(100) NOT NULL DEFAULT '',
          has_french_audio BOOLEAN DEFAULT false,
          has_french_subtitles BOOLEAN DEFAULT false,
          streaming_url TEXT,
          quality VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tmdb_id, platform, country_code, streaming_type, addon_name)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tmdb_platform ON availabilities(tmdb_id, platform)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_updated_at ON availabilities(updated_at)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_country_code ON availabilities(country_code)`);
      console.log('✅ Database initialized');
    }
  } catch (err) {
    console.error('Database init error:', err);
  }
}
initDatabase();

// TMDB API client
const tmdbClient = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  params: {
    api_key: process.env.TMDB_API_KEY,
    language: 'fr-FR'
  }
});

// Streaming Availability API client
const streamingClient = axios.create({
  baseURL: 'https://streaming-availability.p.rapidapi.com',
  headers: {
    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
    'X-RapidAPI-Host': 'streaming-availability.p.rapidapi.com'
  }
});

// ============================================
// TMDB Provider ID to Platform Name mapping
// ============================================
const TMDB_PROVIDER_NAMES = {
  8: 'Netflix',
  9: 'Amazon Prime',
  10: 'Amazon Prime',
  119: 'Amazon Prime',
  337: 'Disney+',
  2: 'Apple TV+',
  350: 'Apple TV+',
  531: 'Paramount+',
  1899: 'Max',
  384: 'Max',
  // Canal+ family
  381: 'Canal+',
  929: 'Canal+',
  1754: 'Canal+ Cinéma',
  345: 'Canal+ Séries',
  334: 'OCS',
  56: 'OCS',
  // French platforms
  236: 'France TV',
  59: 'Arte',
  1870: 'ADN',
  1960: 'Crunchyroll',
  283: 'Crunchyroll',
  192: 'YouTube',
  3: 'Google Play',
  // Other
  15: 'Hulu',
  386: 'Peacock',
  387: 'Peacock',
  1770: 'Paramount+',
  582: 'Pass Warner',
  1967: 'SkyShowtime',
  // Canada
  230: 'Crave',
  // Rent/Buy
  68: 'Microsoft Store',
  35: 'Rakuten TV'
};

// Platform name normalization
const PLATFORM_NORMALIZE = {
  'Netflix': 'Netflix',
  'Amazon Prime Video': 'Amazon Prime',
  'Amazon Prime': 'Amazon Prime',
  'Disney Plus': 'Disney+',
  'Disney+': 'Disney+',
  'Apple TV Plus': 'Apple TV+',
  'Apple TV+': 'Apple TV+',
  'Apple TV': 'Apple TV+',
  'Paramount Plus': 'Paramount+',
  'Paramount+': 'Paramount+',
  'HBO Max': 'Max',
  'Max': 'Max',
  'Canal+': 'Canal+',
  'Canal Plus': 'Canal+',
  'Canal+ Cinema': 'Canal+ Cinéma',
  'Canal+ Cinéma': 'Canal+ Cinéma',
  'Canal+ Series': 'Canal+ Séries',
  'Canal+ Séries': 'Canal+ Séries',
  'MyCanal': 'Canal+',
  'OCS': 'OCS',
  'Crave': 'Crave',
  'Crave Starz': 'Crave',
  'Starz': 'Starz',
  'MGM Plus': 'MGM+',
  'MGM+': 'MGM+',
  'Lionsgate Plus': 'Lionsgate+',
  'Lionsgate+': 'Lionsgate+',
  'Pass Warner': 'Pass Warner',
  'SkyShowtime': 'SkyShowtime',
  'France TV': 'France TV',
  'france.tv': 'France TV',
  'Arte': 'Arte',
  'ARTE': 'Arte',
  'ADN': 'ADN',
  'Anime Digital Network': 'ADN',
  'Crunchyroll': 'Crunchyroll'
};

function normalizePlatformName(name) {
  return PLATFORM_NORMALIZE[name] || name;
}

// Country names
function getCountryName(code) {
  const countries = {
    'FR': 'France', 'BE': 'Belgique', 'CH': 'Suisse', 'CA': 'Canada', 'US': 'États-Unis',
    'GB': 'Royaume-Uni', 'DE': 'Allemagne', 'ES': 'Espagne', 'IT': 'Italie', 'PT': 'Portugal',
    'BR': 'Brésil', 'MX': 'Mexique', 'AR': 'Argentine', 'AU': 'Australie', 'NZ': 'Nouvelle-Zélande',
    'JP': 'Japon', 'KR': 'Corée du Sud', 'IN': 'Inde', 'NL': 'Pays-Bas', 'SE': 'Suède',
    'NO': 'Norvège', 'DK': 'Danemark', 'FI': 'Finlande', 'PL': 'Pologne', 'AT': 'Autriche',
    'IE': 'Irlande', 'LU': 'Luxembourg', 'GR': 'Grèce', 'TR': 'Turquie', 'RU': 'Russie',
    'ZA': 'Afrique du Sud', 'CL': 'Chili', 'CO': 'Colombie', 'PE': 'Pérou', 'VE': 'Venezuela',
    'HU': 'Hongrie', 'CZ': 'Tchéquie', 'RO': 'Roumanie', 'BG': 'Bulgarie', 'HR': 'Croatie',
    'SK': 'Slovaquie', 'SI': 'Slovénie', 'RS': 'Serbie', 'UA': 'Ukraine', 'IL': 'Israël',
    'AE': 'Émirats arabes unis', 'SA': 'Arabie saoudite', 'EG': 'Égypte', 'TH': 'Thaïlande',
    'SG': 'Singapour', 'MY': 'Malaisie', 'ID': 'Indonésie', 'PH': 'Philippines', 'TW': 'Taïwan',
    'HK': 'Hong Kong', 'MK': 'Macédoine du Nord', 'MD': 'Moldavie', 'EC': 'Équateur', 'PA': 'Panama'
  };
  return countries[code] || code;
}

// Sort availabilities with priority countries first
function sortAvailabilities(availabilities) {
  return availabilities.sort((a, b) => {
    const aIdx = PRIORITY_COUNTRIES.indexOf(a.country_code);
    const bIdx = PRIORITY_COUNTRIES.indexOf(b.country_code);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.country_name.localeCompare(b.country_name, 'fr');
  });
}

const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;

// ============================================
// FETCH TMDB WATCH PROVIDERS
// ============================================
async function fetchTmdbWatchProviders(tmdbId, mediaType = 'movie') {
  try {
    const endpoint = mediaType === 'tv' ? `/tv/${tmdbId}/watch/providers` : `/movie/${tmdbId}/watch/providers`;
    const response = await tmdbClient.get(endpoint);
    console.log(`📺 TMDB Watch Providers for ${mediaType} ${tmdbId}: ${Object.keys(response.data.results || {}).length} countries`);
    return response.data.results || {};
  } catch (error) {
    console.error('TMDB Watch Providers error:', error.message);
    return {};
  }
}

// Process TMDB Watch Providers into availabilities
function processTmdbProviders(tmdbId, providersData, mediaType) {
  const availabilities = [];
  
  for (const [countryCode, data] of Object.entries(providersData)) {
    const country = countryCode.toUpperCase();
    const countryName = getCountryName(country);
    const isFrenchSpeaking = FRENCH_SPEAKING_COUNTRIES.includes(country);
    
    // Process flatrate (subscription)
    if (data.flatrate) {
      for (const provider of data.flatrate) {
        const platformName = normalizePlatformName(
          TMDB_PROVIDER_NAMES[provider.provider_id] || provider.provider_name
        );
        
        availabilities.push({
          tmdb_id: tmdbId,
          platform: platformName,
          country_code: country,
          country_name: countryName,
          streaming_type: 'subscription',
          addon_name: '',
          has_french_audio: isFrenchSpeaking,
          has_french_subtitles: isFrenchSpeaking,
          streaming_url: data.link || null,
          quality: 'hd',
          source: 'tmdb'
        });
      }
    }
    
    // Process rent
    if (data.rent) {
      for (const provider of data.rent) {
        const platformName = normalizePlatformName(
          TMDB_PROVIDER_NAMES[provider.provider_id] || provider.provider_name
        );
        
        availabilities.push({
          tmdb_id: tmdbId,
          platform: platformName,
          country_code: country,
          country_name: countryName,
          streaming_type: 'rent',
          addon_name: '',
          has_french_audio: isFrenchSpeaking,
          has_french_subtitles: isFrenchSpeaking,
          streaming_url: data.link || null,
          quality: 'hd',
          source: 'tmdb'
        });
      }
    }
    
    // Process buy
    if (data.buy) {
      for (const provider of data.buy) {
        const platformName = normalizePlatformName(
          TMDB_PROVIDER_NAMES[provider.provider_id] || provider.provider_name
        );
        
        availabilities.push({
          tmdb_id: tmdbId,
          platform: platformName,
          country_code: country,
          country_name: countryName,
          streaming_type: 'buy',
          addon_name: '',
          has_french_audio: isFrenchSpeaking,
          has_french_subtitles: isFrenchSpeaking,
          streaming_url: data.link || null,
          quality: 'hd',
          source: 'tmdb'
        });
      }
    }
  }
  
  return availabilities;
}

// ============================================
// FETCH STREAMING AVAILABILITY API
// ============================================
async function fetchStreamingAvailability(tmdbId, mediaType = 'movie') {
  try {
    const showType = mediaType === 'tv' ? 'tv' : 'movie';
    const response = await streamingClient.get(`/shows/${showType}/${tmdbId}`, {
      params: { output_language: 'fr' }
    });
    console.log(`📡 Streaming API for ${mediaType} ${tmdbId}: ${Object.keys(response.data.streamingOptions || {}).length} countries`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`❌ 404 for ${mediaType} ${tmdbId}`);
      return null;
    }
    console.error('Streaming API error:', error.message);
    return null;
  }
}

// Check for French audio/subtitles
function hasFrench(items) {
  if (!items || !Array.isArray(items)) return false;
  return items.some(item => {
    const lang = (item.language || '').toLowerCase();
    const localeLang = (item.locale?.language || '').toLowerCase();
    return ['fra', 'fr', 'fre', 'french'].includes(lang) || ['fra', 'fr', 'fre', 'french'].includes(localeLang);
  });
}

// Process Streaming Availability data
function processStreamingAvailability(tmdbId, streamingData, mediaType) {
  if (!streamingData?.streamingOptions) return [];
  
  const availabilities = [];
  
  for (const [countryCode, options] of Object.entries(streamingData.streamingOptions)) {
    const country = countryCode.toUpperCase();
    const countryName = getCountryName(country);
    const isFrenchSpeaking = FRENCH_SPEAKING_COUNTRIES.includes(country);
    
    for (const option of options) {
      if (!option?.service) continue;
      
      const serviceId = option.service.id;
      const serviceName = option.service.name;
      const streamingType = option.type || 'subscription';
      const addonName = (streamingType === 'addon' && option.addon?.name) ? option.addon.name : '';
      
      // Filter addons - keep important ones
      if (streamingType === 'addon') {
        const addonLower = addonName.toLowerCase();
        const allowed = ['canal', 'mycanal', 'paramount', 'starz', 'mgm', 'ocs', 'crave', 'lionsgate', 'max', 'hbo', 'pass warner'];
        if (!allowed.some(p => addonLower.includes(p))) continue;
      }
      
      const hasFrenchAudio = hasFrench(option.audios);
      const hasFrenchSubtitles = hasFrench(option.subtitles);
      
      if (!isFrenchSpeaking && !hasFrenchAudio && !hasFrenchSubtitles) continue;
      
      // Determine platform name
      let platformName = serviceName || serviceId;
      if (streamingType === 'addon' && addonName) {
        const addonLower = addonName.toLowerCase();
        if (addonLower.includes('canal') || addonLower.includes('mycanal')) platformName = 'Canal+';
        else if (addonLower.includes('paramount')) platformName = 'Paramount+';
        else if (addonLower.includes('starz')) platformName = 'Starz';
        else if (addonLower.includes('mgm')) platformName = 'MGM+';
        else if (addonLower.includes('crave')) platformName = 'Crave';
        else if (addonLower.includes('max') || addonLower.includes('hbo')) platformName = 'Max';
        else if (addonLower.includes('ocs')) platformName = 'OCS';
        else if (addonLower.includes('lionsgate')) platformName = 'Lionsgate+';
      } else {
        platformName = normalizePlatformName(serviceName || serviceId);
      }
      
      availabilities.push({
        tmdb_id: tmdbId,
        platform: platformName,
        country_code: country,
        country_name: countryName,
        streaming_type: streamingType,
        addon_name: addonName,
        has_french_audio: hasFrenchAudio || isFrenchSpeaking,
        has_french_subtitles: hasFrenchSubtitles,
        streaming_url: option.link || null,
        quality: option.quality || 'hd',
        source: 'streaming-availability'
      });
    }
  }
  
  return availabilities;
}

// ============================================
// MERGE AND CACHE AVAILABILITIES
// ============================================
async function fetchAndMergeAvailabilities(tmdbId, mediaType = 'movie') {
  // Fetch from both sources in parallel
  const [streamingData, tmdbProviders] = await Promise.all([
    fetchStreamingAvailability(tmdbId, mediaType),
    fetchTmdbWatchProviders(tmdbId, mediaType)
  ]);
  
  // Process both sources
  const streamingAvailabilities = processStreamingAvailability(tmdbId, streamingData, mediaType);
  const tmdbAvailabilities = processTmdbProviders(tmdbId, tmdbProviders, mediaType);
  
  console.log(`🔗 Merging: ${streamingAvailabilities.length} from Streaming API + ${tmdbAvailabilities.length} from TMDB`);
  
  // Merge: Use streaming availability as base, add missing from TMDB
  const merged = new Map();
  
  // Add streaming availability first (higher priority - has better links and language info)
  for (const avail of streamingAvailabilities) {
    const key = `${avail.country_code}-${avail.platform}-${avail.streaming_type}`;
    merged.set(key, avail);
  }
  
  // Add TMDB data only if not already present
  for (const avail of tmdbAvailabilities) {
    const key = `${avail.country_code}-${avail.platform}-${avail.streaming_type}`;
    if (!merged.has(key)) {
      merged.set(key, avail);
    }
  }
  
  const finalAvailabilities = Array.from(merged.values());
  console.log(`✅ Final merged: ${finalAvailabilities.length} availabilities`);
  
  // Cache to database
  await pool.query('DELETE FROM availabilities WHERE tmdb_id = $1', [tmdbId]);
  
  for (const avail of finalAvailabilities) {
    try {
      await pool.query(
        `INSERT INTO availabilities 
        (tmdb_id, platform, country_code, country_name, streaming_type, addon_name, has_french_audio, has_french_subtitles, streaming_url, quality, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
        ON CONFLICT (tmdb_id, platform, country_code, streaming_type, addon_name) 
        DO UPDATE SET has_french_audio = $7, has_french_subtitles = $8, streaming_url = $9, updated_at = CURRENT_TIMESTAMP`,
        [tmdbId, avail.platform, avail.country_code, avail.country_name, avail.streaming_type, 
         avail.addon_name || '', avail.has_french_audio, avail.has_french_subtitles, avail.streaming_url, avail.quality]
      );
    } catch (err) {
      console.error('DB insert error:', err.message);
    }
  }
  
  return sortAvailabilities(finalAvailabilities);
}

// ============================================
// ROUTES
// ============================================

// Debug endpoint - shows raw data from both APIs
app.get('/api/debug/:type/:id', async (req, res) => {
  try {
    const tmdbId = parseInt(req.params.id);
    const mediaType = req.params.type;
    
    const [streamingData, tmdbProviders] = await Promise.all([
      fetchStreamingAvailability(tmdbId, mediaType),
      fetchTmdbWatchProviders(tmdbId, mediaType)
    ]);
    
    res.json({
      tmdbId,
      mediaType,
      streamingAvailability: {
        countriesCount: streamingData ? Object.keys(streamingData.streamingOptions || {}).length : 0,
        services: streamingData?.streamingOptions || {}
      },
      tmdbWatchProviders: {
        countriesCount: Object.keys(tmdbProviders).length,
        providers: tmdbProviders
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Countries
app.get('/api/countries', async (req, res) => {
  try {
    const result = await pool.query(`SELECT DISTINCT country_code, country_name FROM availabilities ORDER BY country_name`);
    const countries = result.rows.sort((a, b) => {
      const aIdx = PRIORITY_COUNTRIES.indexOf(a.country_code);
      const bIdx = PRIORITY_COUNTRIES.indexOf(b.country_code);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.country_name.localeCompare(b.country_name, 'fr');
    });
    res.json({ countries });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch countries' });
  }
});

// Search
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.trim().length < 2) return res.json({ results: [] });
    
    const response = await tmdbClient.get('/search/multi', { params: { query } });
    const results = await Promise.all(
      response.data.results
        .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
        .slice(0, 10)
        .map(async (item) => {
          const isMovie = item.media_type === 'movie';
          const countResult = await pool.query(
            'SELECT COUNT(DISTINCT country_code) as count FROM availabilities WHERE tmdb_id = $1',
            [item.id]
          );
          return {
            tmdb_id: item.id,
            media_type: item.media_type,
            title: isMovie ? item.title : item.name,
            year: isMovie 
              ? (item.release_date ? new Date(item.release_date).getFullYear() : null)
              : (item.first_air_date ? new Date(item.first_air_date).getFullYear() : null),
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null,
            vote_average: item.vote_average,
            availability_count: parseInt(countResult.rows[0].count) || 0
          };
        })
    );
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// Genres
app.get('/api/genres', async (req, res) => {
  try {
    const { type = 'movie' } = req.query;
    const endpoint = type === 'tv' ? '/genre/tv/list' : '/genre/movie/list';
    const response = await tmdbClient.get(endpoint);
    res.json({ genres: response.data.genres });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch genres' });
  }
});

// Discover
app.get('/api/discover', async (req, res) => {
  try {
    const { type = 'movie', genre, with_genres, year, primary_release_year, first_air_date_year, sort, sort_by, page = 1 } = req.query;
    const mediaType = type === 'tv' ? 'tv' : 'movie';
    
    const params = { page: parseInt(page), 'vote_count.gte': 100 };
    
    const genreFilter = genre || with_genres;
    const yearFilter = year || primary_release_year || first_air_date_year;
    let sortValue = (sort || sort_by || 'popularity').split('.')[0];
    
    const sortMap = {
      'popularity': 'popularity.desc',
      'vote_average': 'vote_average.desc',
      'release_date': mediaType === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
      'title': mediaType === 'movie' ? 'title.asc' : 'name.asc'
    };
    params.sort_by = sortMap[sortValue] || 'popularity.desc';
    if (genreFilter) params.with_genres = genreFilter;
    if (yearFilter) {
      if (mediaType === 'movie') params.primary_release_year = yearFilter;
      else params.first_air_date_year = yearFilter;
    }
    
    const response = await tmdbClient.get(`/discover/${mediaType}`, { params });
    const results = response.data.results.slice(0, 20).map(item => ({
      tmdb_id: item.id,
      media_type: mediaType,
      title: mediaType === 'movie' ? item.title : item.name,
      year: mediaType === 'movie'
        ? (item.release_date ? new Date(item.release_date).getFullYear() : null)
        : (item.first_air_date ? new Date(item.first_air_date).getFullYear() : null),
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
      vote_average: item.vote_average,
      overview: item.overview,
      genre_ids: item.genre_ids
    }));
    
    res.json({ results, page: response.data.page, total_pages: Math.min(response.data.total_pages, 500), total_results: response.data.total_results });
  } catch (error) {
    res.status(500).json({ error: 'Discover failed' });
  }
});

// Trending
app.get('/api/trending', async (req, res) => {
  try {
    const { type = 'all', time = 'week' } = req.query;
    const mediaType = ['movie', 'tv', 'all'].includes(type) ? type : 'all';
    const response = await tmdbClient.get(`/trending/${mediaType}/${time === 'day' ? 'day' : 'week'}`);
    
    const results = response.data.results
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .slice(0, 20)
      .map(item => ({
        tmdb_id: item.id,
        media_type: item.media_type,
        title: item.media_type === 'movie' ? item.title : item.name,
        year: item.media_type === 'movie'
          ? (item.release_date ? new Date(item.release_date).getFullYear() : null)
          : (item.first_air_date ? new Date(item.first_air_date).getFullYear() : null),
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
        vote_average: item.vote_average,
        overview: item.overview,
        genre_ids: item.genre_ids
      }));
    
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Trending failed' });
  }
});

// ============================================
// MAIN AVAILABILITY ENDPOINT
// ============================================
app.get('/api/media/:type/:id/availability', async (req, res) => {
  try {
    const tmdb_id = parseInt(req.params.id);
    const mediaType = req.params.type;
    const countryFilter = req.query.country;
    const forceRefresh = req.query.refresh === 'true';
    
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return res.status(400).json({ error: 'Invalid media type' });
    }
    
    // Get media details
    const endpoint = mediaType === 'movie' ? `/movie/${tmdb_id}` : `/tv/${tmdb_id}`;
    const mediaResponse = await tmdbClient.get(endpoint);
    const m = mediaResponse.data;
    
    const mediaInfo = {
      media_type: mediaType,
      title: mediaType === 'movie' ? m.title : m.name,
      original_title: mediaType === 'movie' ? m.original_title : m.original_name,
      year: mediaType === 'movie'
        ? (m.release_date ? new Date(m.release_date).getFullYear() : null)
        : (m.first_air_date ? new Date(m.first_air_date).getFullYear() : null),
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null,
      vote_average: m.vote_average,
      overview: m.overview,
      number_of_seasons: mediaType === 'tv' ? m.number_of_seasons : null
    };
    
    let availabilities = [];
    
    // Check cache
    if (!forceRefresh) {
      const cacheCheck = await pool.query(
        'SELECT updated_at FROM availabilities WHERE tmdb_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [tmdb_id]
      );
      
      if (cacheCheck.rows.length > 0) {
        const cacheAge = Date.now() - new Date(cacheCheck.rows[0].updated_at).getTime();
        if (cacheAge < CACHE_DURATION) {
          let query = 'SELECT * FROM availabilities WHERE tmdb_id = $1';
          const params = [tmdb_id];
          if (countryFilter) {
            const countries = countryFilter.toUpperCase().split(',').map(c => c.trim());
            query += ` AND country_code = ANY($2)`;
            params.push(countries);
          }
          const cached = await pool.query(query, params);
          
          return res.json({
            availabilities: sortAvailabilities(cached.rows),
            media: mediaInfo,
            available_countries: await getAvailableCountries(tmdb_id),
            cached: true
          });
        }
      }
    }
    
    // Fetch fresh data from BOTH sources
    availabilities = await fetchAndMergeAvailabilities(tmdb_id, mediaType);
    
    // Apply country filter
    if (countryFilter) {
      const countries = countryFilter.toUpperCase().split(',').map(c => c.trim());
      availabilities = availabilities.filter(a => countries.includes(a.country_code));
    }
    
    res.json({
      availabilities: sortAvailabilities(availabilities),
      media: mediaInfo,
      available_countries: await getAvailableCountries(tmdb_id),
      cached: false
    });
    
  } catch (error) {
    console.error('Availability error:', error);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

async function getAvailableCountries(tmdbId) {
  const result = await pool.query(
    `SELECT DISTINCT country_code, country_name FROM availabilities WHERE tmdb_id = $1 ORDER BY country_name`,
    [tmdbId]
  );
  return result.rows.sort((a, b) => {
    const aIdx = PRIORITY_COUNTRIES.indexOf(a.country_code);
    const bIdx = PRIORITY_COUNTRIES.indexOf(b.country_code);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.country_name.localeCompare(b.country_name, 'fr');
  });
}

// Backwards compatibility
app.get('/api/movie/:id/availability', (req, res) => {
  res.redirect(308, `/api/media/movie/${req.params.id}/availability?${new URLSearchParams(req.query)}`);
});

// Cache management
app.get('/api/clear-all-cache', async (req, res) => {
  const result = await pool.query('DELETE FROM availabilities');
  res.json({ message: `Cleared ${result.rowCount} entries` });
});

app.get('/api/clear-cache/:tmdb_id', async (req, res) => {
  const result = await pool.query('DELETE FROM availabilities WHERE tmdb_id = $1', [req.params.tmdb_id]);
  res.json({ message: `Cleared ${result.rowCount} entries for ${req.params.tmdb_id}` });
});

// Test APIs
app.get('/api/test-apis', async (req, res) => {
  try {
    const [streaming, tmdb] = await Promise.all([
      fetchStreamingAvailability(27205, 'movie'),
      fetchTmdbWatchProviders(27205, 'movie')
    ]);
    res.json({
      success: true,
      streamingAvailability: { 
        working: !!streaming,
        countries: Object.keys(streaming?.streamingOptions || {}).length 
      },
      tmdbWatchProviders: { 
        working: Object.keys(tmdb).length > 0,
        countries: Object.keys(tmdb).length 
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📺 Sources: Streaming Availability API + TMDB Watch Providers`);
});
