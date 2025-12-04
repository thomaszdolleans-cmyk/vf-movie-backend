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

// Initialize database
pool.query(`
  CREATE TABLE IF NOT EXISTS availabilities (
    id SERIAL PRIMARY KEY,
    tmdb_id INTEGER NOT NULL,
    media_type VARCHAR(10) NOT NULL DEFAULT 'movie',
    platform VARCHAR(100) NOT NULL,
    country_code VARCHAR(10) NOT NULL,
    country_name VARCHAR(100) NOT NULL,
    streaming_type VARCHAR(20) NOT NULL DEFAULT 'subscription',
    addon_name VARCHAR(100),
    season_number INTEGER,
    has_french_audio BOOLEAN DEFAULT false,
    has_french_subtitles BOOLEAN DEFAULT false,
    streaming_url TEXT,
    quality VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tmdb_id, media_type, platform, country_code, streaming_type, addon_name, quality, season_number)
  );

  CREATE INDEX IF NOT EXISTS idx_tmdb_platform ON availabilities(tmdb_id, platform);
  CREATE INDEX IF NOT EXISTS idx_updated_at ON availabilities(updated_at);
  CREATE INDEX IF NOT EXISTS idx_streaming_type ON availabilities(streaming_type);
`).catch(err => console.error('Database initialization error:', err));

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
// PLATFORM MAPPINGS
// ============================================
const PLATFORMS = {
  'netflix': 'Netflix',
  'prime': 'Amazon Prime',
  'disney': 'Disney+',
  'hbo': 'Max',
  'apple': 'Apple TV+',
  'paramount': 'Paramount+',
  'peacock': 'Peacock',
  'hulu': 'Hulu',
  'mubi': 'MUBI',
  'stan': 'Stan',
  'now': 'NOW',
  'crave': 'Crave',
  'all4': 'Channel 4',
  'iplayer': 'BBC iPlayer',
  'britbox': 'BritBox',
  'hotstar': 'Disney+ Hotstar',
  'zee5': 'Zee5',
  'curiosity': 'CuriosityStream',
  'wow': 'WOW',
  'canal': 'Canal+'
};

// TMDB Provider ID to Platform Name mapping (NEW!)
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

// Priority countries (French-speaking)
const PRIORITY_COUNTRIES = ['FR', 'BE', 'CH', 'LU', 'CA'];
const FRENCH_SPEAKING_COUNTRIES = ['FR', 'BE', 'CH', 'LU', 'CA', 'MC', 'SN', 'CI', 'ML', 'MG', 'CM', 'HT'];

// Country name mapping (complete list)
function getCountryName(code) {
  const countries = {
    'AD': 'Andorre', 'AE': 'Émirats arabes unis', 'AF': 'Afghanistan', 'AG': 'Antigua-et-Barbuda',
    'AI': 'Anguilla', 'AL': 'Albanie', 'AM': 'Arménie', 'AO': 'Angola', 'AQ': 'Antarctique',
    'AR': 'Argentine', 'AS': 'Samoa américaines', 'AT': 'Autriche', 'AU': 'Australie', 
    'AW': 'Aruba', 'AX': 'Îles Åland', 'AZ': 'Azerbaïdjan', 'BA': 'Bosnie-Herzégovine',
    'BB': 'Barbade', 'BD': 'Bangladesh', 'BE': 'Belgique', 'BF': 'Burkina Faso',
    'BG': 'Bulgarie', 'BH': 'Bahreïn', 'BI': 'Burundi', 'BJ': 'Bénin', 'BL': 'Saint-Barthélemy',
    'BM': 'Bermudes', 'BN': 'Brunei', 'BO': 'Bolivie', 'BQ': 'Bonaire', 'BR': 'Brésil',
    'BS': 'Bahamas', 'BT': 'Bhoutan', 'BV': 'Île Bouvet', 'BW': 'Botswana', 'BY': 'Biélorussie',
    'BZ': 'Belize', 'CA': 'Canada', 'CC': 'Îles Cocos', 'CD': 'Congo (RDC)', 'CF': 'République centrafricaine',
    'CG': 'Congo', 'CH': 'Suisse', 'CI': 'Côte d\'Ivoire', 'CK': 'Îles Cook', 'CL': 'Chili',
    'CM': 'Cameroun', 'CN': 'Chine', 'CO': 'Colombie', 'CR': 'Costa Rica', 'CU': 'Cuba',
    'CV': 'Cap-Vert', 'CW': 'Curaçao', 'CX': 'Île Christmas', 'CY': 'Chypre', 'CZ': 'Tchéquie',
    'DE': 'Allemagne', 'DJ': 'Djibouti', 'DK': 'Danemark', 'DM': 'Dominique', 'DO': 'République dominicaine',
    'DZ': 'Algérie', 'EC': 'Équateur', 'EE': 'Estonie', 'EG': 'Égypte', 'EH': 'Sahara occidental',
    'ER': 'Érythrée', 'ES': 'Espagne', 'ET': 'Éthiopie', 'FI': 'Finlande', 'FJ': 'Fidji',
    'FK': 'Îles Malouines', 'FM': 'Micronésie', 'FO': 'Îles Féroé', 'FR': 'France', 'GA': 'Gabon',
    'GB': 'Royaume-Uni', 'GD': 'Grenade', 'GE': 'Géorgie', 'GF': 'Guyane française', 'GG': 'Guernesey',
    'GH': 'Ghana', 'GI': 'Gibraltar', 'GL': 'Groenland', 'GM': 'Gambie', 'GN': 'Guinée',
    'GP': 'Guadeloupe', 'GQ': 'Guinée équatoriale', 'GR': 'Grèce', 'GS': 'Géorgie du Sud',
    'GT': 'Guatemala', 'GU': 'Guam', 'GW': 'Guinée-Bissau', 'GY': 'Guyana', 'HK': 'Hong Kong',
    'HM': 'Îles Heard-et-MacDonald', 'HN': 'Honduras', 'HR': 'Croatie', 'HT': 'Haïti', 'HU': 'Hongrie',
    'ID': 'Indonésie', 'IE': 'Irlande', 'IL': 'Israël', 'IM': 'Île de Man', 'IN': 'Inde',
    'IO': 'Territoire britannique de l\'océan Indien', 'IQ': 'Irak', 'IR': 'Iran', 'IS': 'Islande',
    'IT': 'Italie', 'JE': 'Jersey', 'JM': 'Jamaïque', 'JO': 'Jordanie', 'JP': 'Japon',
    'KE': 'Kenya', 'KG': 'Kirghizistan', 'KH': 'Cambodge', 'KI': 'Kiribati', 'KM': 'Comores',
    'KN': 'Saint-Kitts-et-Nevis', 'KP': 'Corée du Nord', 'KR': 'Corée du Sud', 'KW': 'Koweït',
    'KY': 'Îles Caïmans', 'KZ': 'Kazakhstan', 'LA': 'Laos', 'LB': 'Liban', 'LC': 'Sainte-Lucie',
    'LI': 'Liechtenstein', 'LK': 'Sri Lanka', 'LR': 'Liberia', 'LS': 'Lesotho', 'LT': 'Lituanie',
    'LU': 'Luxembourg', 'LV': 'Lettonie', 'LY': 'Libye', 'MA': 'Maroc', 'MC': 'Monaco',
    'MD': 'Moldavie', 'ME': 'Monténégro', 'MF': 'Saint-Martin', 'MG': 'Madagascar', 'MH': 'Îles Marshall',
    'MK': 'Macédoine du Nord', 'ML': 'Mali', 'MM': 'Myanmar', 'MN': 'Mongolie', 'MO': 'Macao',
    'MP': 'Îles Mariannes du Nord', 'MQ': 'Martinique', 'MR': 'Mauritanie', 'MS': 'Montserrat',
    'MT': 'Malte', 'MU': 'Maurice', 'MV': 'Maldives', 'MW': 'Malawi', 'MX': 'Mexique',
    'MY': 'Malaisie', 'MZ': 'Mozambique', 'NA': 'Namibie', 'NC': 'Nouvelle-Calédonie', 'NE': 'Niger',
    'NF': 'Île Norfolk', 'NG': 'Nigeria', 'NI': 'Nicaragua', 'NL': 'Pays-Bas', 'NO': 'Norvège',
    'NP': 'Népal', 'NR': 'Nauru', 'NU': 'Niue', 'NZ': 'Nouvelle-Zélande', 'OM': 'Oman',
    'PA': 'Panama', 'PE': 'Pérou', 'PF': 'Polynésie française', 'PG': 'Papouasie-Nouvelle-Guinée',
    'PH': 'Philippines', 'PK': 'Pakistan', 'PL': 'Pologne', 'PM': 'Saint-Pierre-et-Miquelon',
    'PN': 'Îles Pitcairn', 'PR': 'Porto Rico', 'PS': 'Palestine', 'PT': 'Portugal', 'PW': 'Palaos',
    'PY': 'Paraguay', 'QA': 'Qatar', 'RE': 'La Réunion', 'RO': 'Roumanie', 'RS': 'Serbie',
    'RU': 'Russie', 'RW': 'Rwanda', 'SA': 'Arabie saoudite', 'SB': 'Îles Salomon', 'SC': 'Seychelles',
    'SD': 'Soudan', 'SE': 'Suède', 'SG': 'Singapour', 'SH': 'Sainte-Hélène', 'SI': 'Slovénie',
    'SJ': 'Svalbard et Jan Mayen', 'SK': 'Slovaquie', 'SL': 'Sierra Leone', 'SM': 'Saint-Marin',
    'SN': 'Sénégal', 'SO': 'Somalie', 'SR': 'Suriname', 'SS': 'Soudan du Sud', 'ST': 'Sao Tomé-et-Principe',
    'SV': 'Salvador', 'SX': 'Sint Maarten', 'SY': 'Syrie', 'SZ': 'Eswatini', 'TC': 'Îles Turques-et-Caïques',
    'TD': 'Tchad', 'TF': 'Terres australes françaises', 'TG': 'Togo', 'TH': 'Thaïlande', 'TJ': 'Tadjikistan',
    'TK': 'Tokelau', 'TL': 'Timor oriental', 'TM': 'Turkménistan', 'TN': 'Tunisie', 'TO': 'Tonga',
    'TR': 'Turquie', 'TT': 'Trinité-et-Tobago', 'TV': 'Tuvalu', 'TW': 'Taïwan', 'TZ': 'Tanzanie',
    'UA': 'Ukraine', 'UG': 'Ouganda', 'UM': 'Îles mineures éloignées des États-Unis', 'US': 'États-Unis',
    'UY': 'Uruguay', 'UZ': 'Ouzbékistan', 'VA': 'Vatican', 'VC': 'Saint-Vincent-et-les-Grenadines',
    'VE': 'Venezuela', 'VG': 'Îles Vierges britanniques', 'VI': 'Îles Vierges des États-Unis',
    'VN': 'Viêt Nam', 'VU': 'Vanuatu', 'WF': 'Wallis-et-Futuna', 'WS': 'Samoa', 'YE': 'Yémen',
    'YT': 'Mayotte', 'ZA': 'Afrique du Sud', 'ZM': 'Zambie', 'ZW': 'Zimbabwe'
  };
  return countries[code] || code;
}

// Cache duration: 7 days
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;

// Sort availabilities with priority countries first (FR, BE, CH, LU, CA)
function sortByPriorityCountries(availabilities) {
  return availabilities.sort((a, b) => {
    const aIdx = PRIORITY_COUNTRIES.indexOf(a.country_code);
    const bIdx = PRIORITY_COUNTRIES.indexOf(b.country_code);
    
    // Both are priority countries - sort by priority order
    if (aIdx !== -1 && bIdx !== -1) {
      return aIdx - bIdx;
    }
    // Only a is priority - a comes first
    if (aIdx !== -1) return -1;
    // Only b is priority - b comes first
    if (bIdx !== -1) return 1;
    // Neither is priority - sort alphabetically by country name
    return (a.country_name || '').localeCompare(b.country_name || '', 'fr');
  });
}

// ============================================
// TMDB WATCH PROVIDERS (NEW!)
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
        const platformName = TMDB_PROVIDER_NAMES[provider.provider_id] || provider.provider_name;
        
        availabilities.push({
          tmdb_id: tmdbId,
          media_type: mediaType,
          platform: platformName,
          country_code: country,
          country_name: countryName,
          streaming_type: 'subscription',
          addon_name: null,
          season_number: null,
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
        const platformName = TMDB_PROVIDER_NAMES[provider.provider_id] || provider.provider_name;
        
        availabilities.push({
          tmdb_id: tmdbId,
          media_type: mediaType,
          platform: platformName,
          country_code: country,
          country_name: countryName,
          streaming_type: 'rent',
          addon_name: null,
          season_number: null,
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
        const platformName = TMDB_PROVIDER_NAMES[provider.provider_id] || provider.provider_name;
        
        availabilities.push({
          tmdb_id: tmdbId,
          media_type: mediaType,
          platform: platformName,
          country_code: country,
          country_name: countryName,
          streaming_type: 'buy',
          addon_name: null,
          season_number: null,
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
// STREAMING AVAILABILITY API
// ============================================
async function fetchStreamingAvailability(tmdbId, mediaType = 'movie', mediaDetails = null) {
  try {
    const showType = mediaType === 'tv' ? 'tv' : 'movie';
    const endpoint = `/shows/${showType}/${tmdbId}`;
    
    console.log(`📡 Fetching ${mediaType} data: ${endpoint}`);
    
    const response = await streamingClient.get(endpoint, {
      params: {
        series_granularity: mediaType === 'tv' ? 'show' : undefined,
        output_language: 'fr'
      }
    });

    const countriesCount = response.data.streamingOptions ? Object.keys(response.data.streamingOptions).length : 0;
    console.log(`✅ Successfully fetched data for ${mediaType} ${tmdbId} (${countriesCount} countries)`);
    
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`❌ 404 Not Found for ${mediaType} ID ${tmdbId}`);
      return null;
    }
    console.error(`❌ Streaming API error:`, error.response?.data || error.message);
    return null;
  }
}

// Process Streaming Availability data
function processStreamingData(tmdbId, streamingData, mediaType) {
  if (!streamingData || !streamingData.streamingOptions) {
    return [];
  }

  const availabilities = [];
  const streamingOptions = streamingData.streamingOptions;

  for (const [countryCode, options] of Object.entries(streamingOptions)) {
    const country = countryCode.toUpperCase();
    const countryName = getCountryName(country);
    const isFrenchSpeaking = FRENCH_SPEAKING_COUNTRIES.includes(country);

    for (const option of options) {
      if (!option || !option.service) continue;

      const platformKey = option.service.id;
      let platformName = PLATFORMS[platformKey] || option.service.name || platformKey;
      
      const streamingType = option.type || 'subscription';
      const addonName = streamingType === 'addon' && option.addon?.name ? option.addon.name : null;
      
      // FILTER: Skip Prime addons except important ones
      if (platformKey === 'prime' && streamingType === 'addon') {
        const allowedPrimeAddons = ['Starz', 'MGM+', 'MGM Plus', 'MGM', 'STARZ', 'Canal+', 'Canal', 'Paramount', 'Crave', 'OCS', 'Pass Warner', 'Lionsgate'];
        if (!addonName || !allowedPrimeAddons.some(allowed => addonName.toLowerCase().includes(allowed.toLowerCase()))) {
          continue;
        }
        // Use addon name as platform for these
        if (addonName.toLowerCase().includes('canal')) platformName = 'Canal+';
        else if (addonName.toLowerCase().includes('paramount')) platformName = 'Paramount+';
        else if (addonName.toLowerCase().includes('starz')) platformName = 'Starz';
        else if (addonName.toLowerCase().includes('mgm')) platformName = 'MGM+';
        else if (addonName.toLowerCase().includes('crave')) platformName = 'Crave';
        else if (addonName.toLowerCase().includes('ocs')) platformName = 'OCS';
        else if (addonName.toLowerCase().includes('lionsgate')) platformName = 'Lionsgate+';
      }
      
      // Apple TV addons
      if (platformKey === 'apple' && streamingType === 'addon') {
        if (addonName) {
          if (addonName.toLowerCase().includes('canal')) platformName = 'Canal+';
          else if (addonName.toLowerCase().includes('paramount')) platformName = 'Paramount+';
          else if (addonName.toLowerCase().includes('starz')) platformName = 'Starz';
          else if (addonName.toLowerCase().includes('mgm')) platformName = 'MGM+';
          else if (addonName.toLowerCase().includes('ocs')) platformName = 'OCS';
          else continue; // Skip other Apple addons
        }
      }

      // Check for French audio and subtitles
      const hasFrenchAudio = option.audios?.some(a => {
        const lang = a.language?.toLowerCase();
        return lang === 'fra' || lang === 'fr' || lang === 'fre';
      }) || false;

      const hasFrenchSubtitles = option.subtitles?.some(s => {
        if (!s) return false;
        const lang = s.language ? String(s.language).toLowerCase() : '';
        const localeLanguage = s.locale?.language ? String(s.locale.language).toLowerCase() : '';
        return lang === 'fra' || lang === 'fr' || lang === 'fre' || 
               localeLanguage === 'fra' || localeLanguage === 'fr' || localeLanguage === 'fre';
      }) || false;

      // For French-speaking countries, assume French is available
      const effectiveFrenchAudio = hasFrenchAudio || isFrenchSpeaking;
      const effectiveFrenchSubtitles = hasFrenchSubtitles || isFrenchSpeaking;

      // FILTER: Skip if no French content (except for French-speaking countries)
      if (!effectiveFrenchAudio && !effectiveFrenchSubtitles) {
        continue;
      }

      const seasons = mediaType === 'tv' && option.seasons && Array.isArray(option.seasons) 
        ? option.seasons 
        : [null];

      for (const seasonNumber of seasons) {
        availabilities.push({
          tmdb_id: tmdbId,
          media_type: mediaType,
          platform: platformName,
          country_code: country,
          country_name: countryName,
          streaming_type: streamingType,
          addon_name: addonName,
          season_number: seasonNumber,
          has_french_audio: effectiveFrenchAudio,
          has_french_subtitles: effectiveFrenchSubtitles,
          streaming_url: option.link || null,
          quality: option.quality || 'hd',
          source: 'streaming-availability'
        });
      }
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
  const streamingAvailabilities = processStreamingData(tmdbId, streamingData, mediaType);
  const tmdbAvailabilities = processTmdbProviders(tmdbId, tmdbProviders, mediaType);
  
  console.log(`🔗 Merging: ${streamingAvailabilities.length} from Streaming API + ${tmdbAvailabilities.length} from TMDB`);
  
  // Merge: Use streaming availability as base, add missing from TMDB
  const merged = new Map();
  
  // Add streaming availability first (higher priority - has better links and language info)
  for (const avail of streamingAvailabilities) {
    const key = `${avail.country_code}-${avail.platform}-${avail.streaming_type}-${avail.season_number || 'null'}`;
    merged.set(key, avail);
  }
  
  // Add TMDB data only if not already present
  for (const avail of tmdbAvailabilities) {
    const key = `${avail.country_code}-${avail.platform}-${avail.streaming_type}-${avail.season_number || 'null'}`;
    if (!merged.has(key)) {
      merged.set(key, avail);
    }
  }
  
  const finalAvailabilities = Array.from(merged.values());
  console.log(`✅ Final merged: ${finalAvailabilities.length} availabilities`);
  
  return finalAvailabilities;
}

// Cache availabilities to database
async function cacheAvailabilities(tmdbId, availabilities, mediaType) {
  // Delete old cache
  await pool.query('DELETE FROM availabilities WHERE tmdb_id = $1 AND media_type = $2', [tmdbId, mediaType]);
  
  for (const avail of availabilities) {
    try {
      await pool.query(
        `INSERT INTO availabilities 
        (tmdb_id, media_type, platform, country_code, country_name, streaming_type, addon_name, season_number, has_french_audio, has_french_subtitles, streaming_url, quality, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
        ON CONFLICT (tmdb_id, media_type, platform, country_code, streaming_type, addon_name, quality, season_number) 
        DO UPDATE SET 
          has_french_audio = $9,
          has_french_subtitles = $10,
          streaming_url = $11,
          updated_at = CURRENT_TIMESTAMP`,
        [tmdbId, mediaType, avail.platform, avail.country_code, avail.country_name, avail.streaming_type, 
         avail.addon_name, avail.season_number, avail.has_french_audio, avail.has_french_subtitles, 
         avail.streaming_url, avail.quality]
      );
    } catch (dbError) {
      console.error('Database insert error:', dbError.message);
    }
  }
  
  console.log(`✅ Cached ${availabilities.length} availabilities for TMDB ID ${tmdbId}`);
}

// ============================================
// ROUTES
// ============================================

// Search movies AND TV series
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim().length < 2) {
      return res.json({ results: [] });
    }

    const searchResponse = await tmdbClient.get('/search/multi', {
      params: { query }
    });

    const results = await Promise.all(
      searchResponse.data.results
        .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
        .slice(0, 10)
        .map(async (item) => {
          const isMovie = item.media_type === 'movie';
          const tmdbId = item.id;
          
          const countResult = await pool.query(
            'SELECT COUNT(DISTINCT country_code) as count FROM availabilities WHERE tmdb_id = $1 AND media_type = $2',
            [tmdbId, item.media_type]
          );

          return {
            tmdb_id: tmdbId,
            media_type: item.media_type,
            title: isMovie ? item.title : item.name,
            original_title: isMovie ? item.original_title : item.original_name,
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
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get list of genres
app.get('/api/genres', async (req, res) => {
  try {
    const { type = 'movie' } = req.query;
    const endpoint = type === 'tv' ? '/genre/tv/list' : '/genre/movie/list';
    const response = await tmdbClient.get(endpoint);
    res.json({ genres: response.data.genres });
  } catch (error) {
    console.error('Genres error:', error);
    res.status(500).json({ error: 'Failed to fetch genres' });
  }
});

// Discover movies and TV series
app.get('/api/discover', async (req, res) => {
  try {
    const { 
      type = 'movie',
      genre,
      with_genres,
      year,
      primary_release_year,
      first_air_date_year,
      sort = 'popularity',
      sort_by,
      page = 1 
    } = req.query;

    const mediaType = type === 'tv' ? 'tv' : 'movie';
    const endpoint = `/discover/${mediaType}`;

    const params = {
      page: parseInt(page),
      'vote_count.gte': 100,
    };

    // Handle genre parameter
    const genreFilter = genre || with_genres;
    if (genreFilter) {
      params.with_genres = genreFilter;
    }

    // Handle year parameter
    const yearFilter = year || primary_release_year || first_air_date_year;
    if (yearFilter) {
      if (mediaType === 'movie') {
        params.primary_release_year = yearFilter;
      } else {
        params.first_air_date_year = yearFilter;
      }
    }

    // Handle sort parameter
    const sortValue = (sort || sort_by || 'popularity').split('.')[0];
    const sortMap = {
      'popularity': 'popularity.desc',
      'vote_average': 'vote_average.desc',
      'release_date': mediaType === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
      'title': mediaType === 'movie' ? 'title.asc' : 'name.asc'
    };
    params.sort_by = sortMap[sortValue] || 'popularity.desc';

    const response = await tmdbClient.get(endpoint, { params });

    const results = response.data.results.slice(0, 20).map(item => {
      const isMovie = mediaType === 'movie';
      return {
        tmdb_id: item.id,
        media_type: mediaType,
        title: isMovie ? item.title : item.name,
        original_title: isMovie ? item.original_title : item.original_name,
        year: isMovie 
          ? (item.release_date ? new Date(item.release_date).getFullYear() : null)
          : (item.first_air_date ? new Date(item.first_air_date).getFullYear() : null),
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
        vote_average: item.vote_average,
        overview: item.overview,
        genre_ids: item.genre_ids
      };
    });

    res.json({ 
      results,
      page: response.data.page,
      total_pages: Math.min(response.data.total_pages, 500),
      total_results: response.data.total_results
    });
  } catch (error) {
    console.error('Discover error:', error);
    res.status(500).json({ error: 'Discover failed' });
  }
});

// Get trending
app.get('/api/trending', async (req, res) => {
  try {
    const { type = 'all', time = 'week' } = req.query;
    
    const mediaType = ['movie', 'tv', 'all'].includes(type) ? type : 'all';
    const timeWindow = time === 'day' ? 'day' : 'week';

    const response = await tmdbClient.get(`/trending/${mediaType}/${timeWindow}`);

    const results = response.data.results
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .slice(0, 20)
      .map(item => {
        const isMovie = item.media_type === 'movie';
        return {
          tmdb_id: item.id,
          media_type: item.media_type,
          title: isMovie ? item.title : item.name,
          original_title: isMovie ? item.original_title : item.original_name,
          year: isMovie 
            ? (item.release_date ? new Date(item.release_date).getFullYear() : null)
            : (item.first_air_date ? new Date(item.first_air_date).getFullYear() : null),
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
          backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
          vote_average: item.vote_average,
          overview: item.overview,
          genre_ids: item.genre_ids
        };
      });

    res.json({ results });
  } catch (error) {
    console.error('Trending error:', error);
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
    const forceRefresh = req.query.refresh === 'true';

    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return res.status(400).json({ error: 'Invalid media type. Must be "movie" or "tv"' });
    }

    // Get media details from TMDB
    const endpoint = mediaType === 'movie' ? `/movie/${tmdb_id}` : `/tv/${tmdb_id}`;
    const mediaResponse = await tmdbClient.get(endpoint);
    const mediaDetails = mediaResponse.data;

    const mediaInfo = {
      media_type: mediaType,
      title: mediaType === 'movie' ? mediaDetails.title : mediaDetails.name,
      original_title: mediaType === 'movie' ? mediaDetails.original_title : mediaDetails.original_name,
      year: mediaType === 'movie'
        ? (mediaDetails.release_date ? new Date(mediaDetails.release_date).getFullYear() : null)
        : (mediaDetails.first_air_date ? new Date(mediaDetails.first_air_date).getFullYear() : null),
      poster: mediaDetails.poster_path ? `https://image.tmdb.org/t/p/w500${mediaDetails.poster_path}` : null,
      backdrop: mediaDetails.backdrop_path ? `https://image.tmdb.org/t/p/w1280${mediaDetails.backdrop_path}` : null,
      vote_average: mediaDetails.vote_average,
      overview: mediaDetails.overview,
      number_of_seasons: mediaType === 'tv' ? mediaDetails.number_of_seasons : null
    };

    // Check cache
    if (!forceRefresh) {
      const cacheCheck = await pool.query(
        'SELECT updated_at FROM availabilities WHERE tmdb_id = $1 AND media_type = $2 ORDER BY updated_at DESC LIMIT 1',
        [tmdb_id, mediaType]
      );

      if (cacheCheck.rows.length > 0) {
        const cacheAge = Date.now() - new Date(cacheCheck.rows[0].updated_at).getTime();

        if (cacheAge < CACHE_DURATION) {
          console.log(`✅ Using cached data (${Math.round(cacheAge / (1000 * 60 * 60))} hours old)`);

          const cached = await pool.query(
            'SELECT * FROM availabilities WHERE tmdb_id = $1 AND media_type = $2',
            [tmdb_id, mediaType]
          );

          // Sort with priority countries first
          const sortedResults = sortByPriorityCountries(cached.rows);

          return res.json({ 
            availabilities: sortedResults,
            media: mediaInfo,
            cached: true,
            sources: ['cache']
          });
        }
      }
    }

    // Fetch fresh data from BOTH sources
    const availabilities = await fetchAndMergeAvailabilities(tmdb_id, mediaType);
    
    // Cache the results
    await cacheAvailabilities(tmdb_id, availabilities, mediaType);

    // Sort with priority countries first
    const sortedResults = sortByPriorityCountries(availabilities);

    res.json({ 
      availabilities: sortedResults,
      media: mediaInfo,
      cached: false,
      sources: ['streaming-availability', 'tmdb-watch-providers']
    });

  } catch (error) {
    console.error('Availability error:', error);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

// Backwards compatibility
app.get('/api/movie/:id/availability', async (req, res) => {
  return res.redirect(308, `/api/media/movie/${req.params.id}/availability`);
});

// ============================================
// DEBUG ENDPOINTS
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

// Debug subtitles
app.get('/api/debug-subtitles/:tmdb_id', async (req, res) => {
  try {
    const tmdbId = req.params.tmdb_id;
    
    const response = await streamingClient.get(`/shows/movie/${tmdbId}`, {
      params: { series_granularity: 'show', output_language: 'fr' }
    });

    const subtitleData = [];
    
    if (response.data.streamingOptions) {
      for (const [country, options] of Object.entries(response.data.streamingOptions)) {
        for (const option of options) {
          if (option.subtitles && option.subtitles.length > 0) {
            subtitleData.push({
              country,
              platform: option.service?.name,
              subtitles: option.subtitles,
              audios: option.audios
            });
          }
        }
      }
    }

    res.json({
      tmdb_id: tmdbId,
      total_options: Object.values(response.data.streamingOptions || {}).flat().length,
      options_with_subtitles: subtitleData.length,
      subtitle_samples: subtitleData.slice(0, 10)
    });

  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

// Debug addons
app.get('/api/debug-addons/:tmdb_id', async (req, res) => {
  try {
    const tmdbId = req.params.tmdb_id;
    
    const response = await streamingClient.get(`/shows/movie/${tmdbId}`, {
      params: { series_granularity: 'show', output_language: 'fr' }
    });

    const addonSamples = [];
    
    if (response.data.streamingOptions) {
      for (const [country, options] of Object.entries(response.data.streamingOptions)) {
        for (const option of options) {
          if (option.type === 'addon') {
            addonSamples.push({
              country,
              platform: option.service?.name || option.service?.id,
              type: option.type,
              addon: option.addon,
              service: option.service,
              full_option: option
            });
          }
        }
      }
    }

    res.json({
      tmdb_id: tmdbId,
      total_addons: addonSamples.length,
      addon_samples: addonSamples.slice(0, 10)
    });

  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

// Debug duplicates
app.get('/api/debug-duplicates/:tmdb_id', async (req, res) => {
  try {
    const tmdb_id = parseInt(req.params.tmdb_id);
    
    const result = await pool.query(
      `SELECT tmdb_id, platform, country_code, country_name, streaming_type, addon_name, 
              quality, has_french_audio, has_french_subtitles, streaming_url
       FROM availabilities 
       WHERE tmdb_id = $1 
       ORDER BY country_code, platform, streaming_type, addon_name`,
      [tmdb_id]
    );
    
    const seen = new Map();
    const duplicates = [];
    
    result.rows.forEach(row => {
      const key = `${row.country_code}-${row.platform}-${row.streaming_type}-${row.addon_name}`;
      if (seen.has(key)) {
        duplicates.push({ key, first: seen.get(key), duplicate: row });
      } else {
        seen.set(key, row);
      }
    });
    
    res.json({
      total_entries: result.rows.length,
      unique_keys: seen.size,
      duplicates_found: duplicates.length,
      duplicates: duplicates,
      sample_entries: result.rows.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CACHE MANAGEMENT
// ============================================

app.get('/api/clear-all-cache', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM availabilities');
    res.json({ message: `Cleared ${result.rowCount} cached entries` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

app.get('/api/clear-cache/:tmdb_id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM availabilities WHERE tmdb_id = $1', [req.params.tmdb_id]);
    res.json({ message: `Cleared ${result.rowCount} cached entries for TMDB ID ${req.params.tmdb_id}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Reset database
app.get('/api/reset-database', async (req, res) => {
  try {
    await pool.query('DROP TABLE IF EXISTS availabilities');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS availabilities (
        id SERIAL PRIMARY KEY,
        tmdb_id INTEGER NOT NULL,
        media_type VARCHAR(10) NOT NULL DEFAULT 'movie',
        platform VARCHAR(100) NOT NULL,
        country_code VARCHAR(10) NOT NULL,
        country_name VARCHAR(100) NOT NULL,
        streaming_type VARCHAR(20) NOT NULL DEFAULT 'subscription',
        addon_name VARCHAR(100),
        season_number INTEGER,
        has_french_audio BOOLEAN DEFAULT false,
        has_french_subtitles BOOLEAN DEFAULT false,
        streaming_url TEXT,
        quality VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tmdb_id, media_type, platform, country_code, streaming_type, addon_name, quality, season_number)
      );
      CREATE INDEX IF NOT EXISTS idx_tmdb_platform ON availabilities(tmdb_id, platform);
      CREATE INDEX IF NOT EXISTS idx_updated_at ON availabilities(updated_at);
    `);
    res.json({ success: true, message: 'Database reset successfully!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
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

app.get('/api/test-streaming-api', async (req, res) => {
  try {
    const testTmdbId = '27205';
    
    if (!process.env.RAPIDAPI_KEY) {
      return res.json({
        success: false,
        error: 'RAPIDAPI_KEY is not configured'
      });
    }

    const response = await streamingClient.get(`/shows/movie/${testTmdbId}`, {
      params: { series_granularity: 'show', output_language: 'fr' }
    });

    const platformCount = Object.keys(response.data.streamingOptions || {}).length;
    
    res.json({
      success: true,
      message: 'API is working!',
      test_movie: `Inception (TMDB ID: ${testTmdbId})`,
      countries_found: platformCount
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Countries endpoint
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📺 Sources: Streaming Availability API + TMDB Watch Providers`);
  console.log(`📊 Cache duration: ${CACHE_DURATION / (1000 * 60 * 60 * 24)} days`);
});
