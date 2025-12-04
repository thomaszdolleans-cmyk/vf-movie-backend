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

// Priority countries (French-speaking) - will appear first in results
const PRIORITY_COUNTRIES = ['FR', 'BE', 'CH', 'LU', 'CA'];

// French-speaking countries - less strict filtering for these
const FRENCH_SPEAKING_COUNTRIES = ['FR', 'BE', 'CH', 'LU', 'CA', 'MC', 'SN', 'CI', 'ML', 'MG', 'CM', 'HT'];

// Initialize database with proper constraints
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
      
      console.log('✅ Database initialized successfully');
    } else {
      console.log('✅ Database already initialized');
    }
  } catch (err) {
    console.error('Database initialization error:', err);
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
// EXTENDED Platform mapping - ALL known services
// ============================================
const PLATFORMS = {
  // Major international platforms
  'netflix': 'Netflix',
  'prime': 'Amazon Prime',
  'amazon': 'Amazon Prime',
  'amazonprime': 'Amazon Prime',
  'disney': 'Disney+',
  'disneyplus': 'Disney+',
  'hbo': 'Max',
  'hbomax': 'Max',
  'max': 'Max',
  'apple': 'Apple TV+',
  'appletv': 'Apple TV+',
  'appletvplus': 'Apple TV+',
  
  // Paramount
  'paramount': 'Paramount+',
  'paramountplus': 'Paramount+',
  'paramountplusamazon': 'Paramount+',
  
  // Canal+ family (French)
  'canal': 'Canal+',
  'canalplus': 'Canal+',
  'mycanal': 'Canal+',
  'canalplusseries': 'Canal+ Séries',
  'canalpluscine': 'Canal+ Cinéma',
  'canalpluspremier': 'Canal+ Premier',
  
  // French platforms
  'ocs': 'OCS',
  'orange': 'Orange VOD',
  'francetv': 'France TV',
  'salto': 'Salto',
  'arte': 'Arte',
  'tf1plus': 'TF1+',
  'tf1': 'TF1+',
  'm6plus': 'M6+',
  'm6': 'M6+',
  'molotov': 'Molotov',
  'pass': 'Pass Warner',
  'passwarner': 'Pass Warner',
  
  // US platforms
  'peacock': 'Peacock',
  'hulu': 'Hulu',
  'showtime': 'Showtime',
  'starz': 'Starz',
  'mgm': 'MGM+',
  'mgmplus': 'MGM+',
  'epix': 'MGM+',
  'amc': 'AMC+',
  'amcplus': 'AMC+',
  'criterion': 'Criterion Channel',
  'criterionchannel': 'Criterion Channel',
  
  // UK platforms
  'now': 'NOW',
  'nowtv': 'NOW TV',
  'sky': 'Sky',
  'skygo': 'Sky Go',
  'iplayer': 'BBC iPlayer',
  'bbc': 'BBC iPlayer',
  'bbciplayer': 'BBC iPlayer',
  'britbox': 'BritBox',
  'all4': 'Channel 4',
  'channel4': 'Channel 4',
  'itv': 'ITVX',
  'itvx': 'ITVX',
  
  // Canadian
  'crave': 'Crave',
  'tubi': 'Tubi',
  
  // Specialty/Niche
  'mubi': 'MUBI',
  'curiosity': 'CuriosityStream',
  'curiositystream': 'CuriosityStream',
  'wow': 'WOW',
  'stan': 'Stan',
  'hotstar': 'Disney+ Hotstar',
  'disneyhotstar': 'Disney+ Hotstar',
  'zee5': 'Zee5',
  
  // Anime
  'crunchyroll': 'Crunchyroll',
  'funimation': 'Funimation',
  'adn': 'ADN',
  'wakanim': 'Wakanim',
  
  // Free/Ad-supported
  'pluto': 'Pluto TV',
  'plutotv': 'Pluto TV',
  'freevee': 'Freevee',
  'imdbfreevee': 'Freevee',
  'roku': 'Roku Channel',
  'rokuchannel': 'Roku Channel',
  'plex': 'Plex',
  
  // VOD/Purchase platforms
  'vudu': 'Vudu',
  'googleplay': 'Google Play',
  'google': 'Google Play',
  'itunes': 'iTunes',
  'youtube': 'YouTube',
  'youtubepremium': 'YouTube Premium',
  'microsoft': 'Microsoft Store'
};

// Country name mapping
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

// Get platform name from service ID (with fallback)
function getPlatformName(serviceId, serviceName) {
  if (!serviceId) return serviceName || 'Unknown';
  
  // Normalize: lowercase and remove special chars
  const normalizedId = serviceId.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Check our mapping
  if (PLATFORMS[normalizedId]) {
    return PLATFORMS[normalizedId];
  }
  
  // Check original ID
  if (PLATFORMS[serviceId.toLowerCase()]) {
    return PLATFORMS[serviceId.toLowerCase()];
  }
  
  // Fallback to provided name or capitalize the ID
  return serviceName || serviceId.charAt(0).toUpperCase() + serviceId.slice(1);
}

// Sort availabilities with priority countries first
function sortAvailabilities(availabilities) {
  return availabilities.sort((a, b) => {
    const aIndex = PRIORITY_COUNTRIES.indexOf(a.country_code);
    const bIndex = PRIORITY_COUNTRIES.indexOf(b.country_code);
    
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.country_name.localeCompare(b.country_name, 'fr');
  });
}

// Cache duration: 7 days
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;

// Fetch streaming availability from Streaming Availability API
async function fetchStreamingAvailability(tmdbId, mediaType = 'movie') {
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

// Check if audio/subtitle has French
function hasFrench(items) {
  if (!items || !Array.isArray(items)) return false;
  
  return items.some(item => {
    if (!item) return false;
    
    // Check direct language property
    const lang = item.language ? String(item.language).toLowerCase() : '';
    if (lang === 'fra' || lang === 'fr' || lang === 'fre' || lang === 'french') {
      return true;
    }
    
    // Check locale.language (some API responses use this structure)
    if (item.locale?.language) {
      const localeLang = String(item.locale.language).toLowerCase();
      if (localeLang === 'fra' || localeLang === 'fr' || localeLang === 'fre' || localeLang === 'french') {
        return true;
      }
    }
    
    return false;
  });
}

// Process and cache streaming data
async function processAndCacheStreaming(tmdbId, streamingData, mediaType = 'movie') {
  if (!streamingData || !streamingData.streamingOptions) {
    console.log('No streaming options available');
    return [];
  }

  const availabilities = [];
  const streamingOptions = streamingData.streamingOptions;

  // Delete old cache for this item
  await pool.query('DELETE FROM availabilities WHERE tmdb_id = $1', [tmdbId]);

  // Log all services for debugging
  const allServices = new Set();

  // Process each country
  for (const [countryCode, options] of Object.entries(streamingOptions)) {
    const country = countryCode.toUpperCase();
    const countryName = getCountryName(country);
    const isFrenchSpeakingCountry = FRENCH_SPEAKING_COUNTRIES.includes(country);

    // Process each streaming option in this country
    for (const option of options) {
      if (!option || !option.service) continue;

      const serviceId = option.service.id;
      const serviceName = option.service.name;
      allServices.add(`${serviceId} (${serviceName})`);
      
      const platformName = getPlatformName(serviceId, serviceName);
      const streamingType = option.type || 'subscription';
      const addonName = (streamingType === 'addon' && option.addon?.name) ? option.addon.name : '';
      
      // FILTER: Skip most Prime/Apple addons (too many irrelevant ones)
      // But KEEP important ones like Canal+, Paramount+, Starz, MGM+, OCS, Crave, Lionsgate+
      if (streamingType === 'addon') {
        const addonLower = addonName.toLowerCase();
        const allowedPatterns = [
          'canal', 'mycanal', 'canalplus', 'canal+',  // Canal+ family
          'paramount',                                  // Paramount+
          'starz', 'mgm', 'ocs', 'crave', 'lionsgate', // Other premium
          'max', 'hbo',                                 // Max/HBO
          'pass warner', 'passwarner'                   // Pass Warner (France)
        ];
        const isAllowed = allowedPatterns.some(pattern => addonLower.includes(pattern));
        if (!isAllowed) {
          continue;
        }
      }
      
      // For Prime/Apple addons that are actually streaming services, use the addon name as platform
      let finalPlatformName = platformName;
      if (streamingType === 'addon' && addonName) {
        // Map addon IDs to proper platform names
        const addonLower = addonName.toLowerCase();
        if (addonLower.includes('canal') || addonLower.includes('mycanal')) {
          finalPlatformName = 'Canal+';
        } else if (addonLower.includes('paramount')) {
          finalPlatformName = 'Paramount+';
        } else if (addonLower.includes('starz')) {
          finalPlatformName = 'Starz';
        } else if (addonLower.includes('mgm')) {
          finalPlatformName = 'MGM+';
        } else if (addonLower.includes('lionsgate')) {
          finalPlatformName = 'Lionsgate+';
        } else if (addonLower.includes('crave')) {
          finalPlatformName = 'Crave';
        } else if (addonLower.includes('max') || addonLower.includes('hbo')) {
          finalPlatformName = 'Max';
        } else if (addonLower.includes('ocs')) {
          finalPlatformName = 'OCS';
        } else if (addonLower.includes('skyshowtime')) {
          finalPlatformName = 'SkyShowtime';
        } else if (addonLower.includes('pass warner') || addonLower.includes('passwarner')) {
          finalPlatformName = 'Pass Warner';
        }
        // For addons, change type to subscription since that's what users care about
        // They want to know they can watch on Paramount+, not that it's an "addon"
      }

      // Check for French audio and subtitles
      const hasFrenchAudio = hasFrench(option.audios);
      const hasFrenchSubtitles = hasFrench(option.subtitles);

      // ============================================
      // RELAXED FILTER for French-speaking countries
      // ============================================
      // For FR, BE, CH, CA, LU: Include ALL content (assume French is available)
      // For other countries: Require French audio OR subtitles
      
      if (!isFrenchSpeakingCountry && !hasFrenchAudio && !hasFrenchSubtitles) {
        continue;
      }

      // For French-speaking countries, assume French is available if not explicitly detected
      const finalHasFrenchAudio = hasFrenchAudio || isFrenchSpeakingCountry;
      const finalHasFrenchSubtitles = hasFrenchSubtitles;

      const availability = {
        tmdb_id: tmdbId,
        platform: finalPlatformName,
        country_code: country,
        country_name: countryName,
        streaming_type: streamingType,
        addon_name: addonName,
        has_french_audio: finalHasFrenchAudio,
        has_french_subtitles: finalHasFrenchSubtitles,
        streaming_url: option.link || null,
        quality: option.quality || 'hd'
      };

      try {
        await pool.query(
          `INSERT INTO availabilities 
          (tmdb_id, platform, country_code, country_name, streaming_type, addon_name, has_french_audio, has_french_subtitles, streaming_url, quality, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
          ON CONFLICT (tmdb_id, platform, country_code, streaming_type, addon_name) 
          DO UPDATE SET 
            has_french_audio = $7,
            has_french_subtitles = $8,
            streaming_url = $9,
            updated_at = CURRENT_TIMESTAMP`,
          [tmdbId, finalPlatformName, country, countryName, streamingType, addonName, finalHasFrenchAudio, finalHasFrenchSubtitles, option.link, option.quality || 'hd']
        );
        availabilities.push(availability);
      } catch (dbError) {
        console.error('Database insert error:', dbError);
      }
    }
  }

  console.log(`📋 All services found: ${Array.from(allServices).join(', ')}`);
  console.log(`✅ Cached ${availabilities.length} availabilities for TMDB ID ${tmdbId}`);
  return sortAvailabilities(availabilities);
}

// ============================================
// ROUTES
// ============================================

// DEBUG: Get raw streaming data (useful for debugging missing platforms)
app.get('/api/debug/:type/:id', async (req, res) => {
  try {
    const tmdbId = parseInt(req.params.id);
    const mediaType = req.params.type;
    
    const streamingData = await fetchStreamingAvailability(tmdbId, mediaType);
    
    if (!streamingData) {
      return res.json({ error: 'No data found', tmdbId, mediaType });
    }

    // Extract detailed service info for each country
    const services = {};
    if (streamingData.streamingOptions) {
      for (const [country, options] of Object.entries(streamingData.streamingOptions)) {
        services[country] = options.map(opt => ({
          serviceId: opt.service?.id,
          serviceName: opt.service?.name,
          type: opt.type,
          addon: opt.addon?.name,
          audios: opt.audios,
          subtitles: opt.subtitles,
          link: opt.link
        }));
      }
    }

    res.json({
      tmdbId,
      mediaType,
      title: streamingData.title,
      countriesCount: Object.keys(streamingData.streamingOptions || {}).length,
      services
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get list of available countries (for filter dropdown)
app.get('/api/countries', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT country_code, country_name 
      FROM availabilities 
      ORDER BY country_name
    `);
    
    const countries = result.rows.sort((a, b) => {
      const aIndex = PRIORITY_COUNTRIES.indexOf(a.country_code);
      const bIndex = PRIORITY_COUNTRIES.indexOf(b.country_code);
      
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.country_name.localeCompare(b.country_name, 'fr');
    });
    
    res.json({ countries });
  } catch (error) {
    console.error('Countries error:', error);
    res.status(500).json({ error: 'Failed to fetch countries' });
  }
});

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
            'SELECT COUNT(DISTINCT country_code) as count FROM availabilities WHERE tmdb_id = $1',
            [tmdbId]
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

// Discover movies and TV series with filters
app.get('/api/discover', async (req, res) => {
  try {
    const { 
      type = 'movie',
      genre,
      with_genres,
      year,
      primary_release_year,
      first_air_date_year,
      sort,
      sort_by,
      page = 1 
    } = req.query;

    const mediaType = type === 'tv' ? 'tv' : 'movie';
    const endpoint = `/discover/${mediaType}`;

    const genreFilter = genre || with_genres;
    const yearFilter = year || primary_release_year || first_air_date_year;
    
    let sortValue = sort || sort_by || 'popularity';
    if (sortValue.includes('.')) {
      sortValue = sortValue.split('.')[0];
    }

    const params = {
      page: parseInt(page),
      'vote_count.gte': 100,
    };

    const sortMap = {
      'popularity': 'popularity.desc',
      'vote_average': 'vote_average.desc',
      'release_date': mediaType === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
      'title': mediaType === 'movie' ? 'title.asc' : 'name.asc'
    };
    params.sort_by = sortMap[sortValue] || 'popularity.desc';

    if (genreFilter) {
      params.with_genres = genreFilter;
    }

    if (yearFilter) {
      if (mediaType === 'movie') {
        params.primary_release_year = yearFilter;
      } else {
        params.first_air_date_year = yearFilter;
      }
    }

    console.log(`🔍 Discovering ${mediaType}s with params:`, params);

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

// Get trending movies and TV series
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

// Get media availability (movies and TV series)
app.get('/api/media/:type/:id/availability', async (req, res) => {
  try {
    const tmdb_id = parseInt(req.params.id);
    const mediaType = req.params.type;
    const countryFilter = req.query.country;
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

    // Check cache (unless force refresh)
    if (!forceRefresh) {
      const cacheCheck = await pool.query(
        'SELECT updated_at FROM availabilities WHERE tmdb_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [tmdb_id]
      );

      if (cacheCheck.rows.length > 0) {
        const cacheAge = Date.now() - new Date(cacheCheck.rows[0].updated_at).getTime();

        if (cacheAge < CACHE_DURATION) {
          console.log(`✅ Using cached data for "${mediaInfo.title}"`);

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

    // Fetch fresh data
    console.log(`🔍 Fetching streaming data for "${mediaInfo.title}"`);
    const streamingData = await fetchStreamingAvailability(tmdb_id, mediaType);

    if (!streamingData) {
      return res.json({ 
        availabilities: [],
        media: mediaInfo,
        available_countries: [],
        cached: false
      });
    }

    let availabilities = await processAndCacheStreaming(tmdb_id, streamingData, mediaType);

    // Apply country filter if specified
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

// Helper function to get available countries for a media
async function getAvailableCountries(tmdbId) {
  const result = await pool.query(`
    SELECT DISTINCT country_code, country_name 
    FROM availabilities 
    WHERE tmdb_id = $1
    ORDER BY country_name
  `, [tmdbId]);
  
  return result.rows.sort((a, b) => {
    const aIndex = PRIORITY_COUNTRIES.indexOf(a.country_code);
    const bIndex = PRIORITY_COUNTRIES.indexOf(b.country_code);
    
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.country_name.localeCompare(b.country_name, 'fr');
  });
}

// Backwards compatibility
app.get('/api/movie/:id/availability', async (req, res) => {
  return res.redirect(308, `/api/media/movie/${req.params.id}/availability`);
});

// Clear all cache
app.get('/api/clear-all-cache', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM availabilities');
    res.json({ message: `Cleared ${result.rowCount} cached entries` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Clear cache for specific movie
app.get('/api/clear-cache/:tmdb_id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM availabilities WHERE tmdb_id = $1', [req.params.tmdb_id]);
    res.json({ message: `Cleared ${result.rowCount} cached entries for TMDB ID ${req.params.tmdb_id}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Test Streaming API
app.get('/api/test-streaming-api', async (req, res) => {
  try {
    const testTmdbId = '27205'; // Inception
    
    if (!process.env.RAPIDAPI_KEY) {
      return res.json({
        success: false,
        error: 'RAPIDAPI_KEY is not configured'
      });
    }

    const response = await streamingClient.get(`/shows/movie/${testTmdbId}`, {
      params: { output_language: 'fr' }
    });

    const platformCount = Object.keys(response.data.streamingOptions || {}).length;

    res.json({
      success: true,
      message: 'API is working!',
      test_movie: 'Inception',
      countries_found: platformCount
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Cache duration: ${CACHE_DURATION / (1000 * 60 * 60 * 24)} days`);
  console.log(`🇫🇷 Priority countries: ${PRIORITY_COUNTRIES.join(', ')}`);
  console.log(`📺 Platforms mapped: ${Object.keys(PLATFORMS).length}`);
});
