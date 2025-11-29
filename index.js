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
    platform VARCHAR(50) NOT NULL,
    country_code VARCHAR(10) NOT NULL,
    country_name VARCHAR(100) NOT NULL,
    has_french_audio BOOLEAN DEFAULT false,
    has_french_subtitles BOOLEAN DEFAULT false,
    streaming_url TEXT,
    quality VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tmdb_id, platform, country_code)
  );

  CREATE INDEX IF NOT EXISTS idx_tmdb_platform ON availabilities(tmdb_id, platform);
  CREATE INDEX IF NOT EXISTS idx_updated_at ON availabilities(updated_at);
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

// Platform mapping
const PLATFORMS = {
  'netflix': 'Netflix',
  'prime': 'Amazon Prime',
  'disney': 'Disney+',
  'hbo': 'HBO Max',
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

// Fetch streaming availability from Streaming Availability API
async function fetchStreamingAvailability(imdbId) {
  try {
    const response = await streamingClient.get('/get', {
      params: {
        imdb_id: imdbId,
        output_language: 'fr'
      }
    });

    return response.data;
  } catch (error) {
    console.error('Streaming Availability API error:', error.response?.data || error.message);
    return null;
  }
}

// Process and cache streaming data
async function processAndCacheStreaming(tmdbId, streamingData) {
  if (!streamingData || !streamingData.streamingInfo) {
    console.log('No streaming info available');
    return [];
  }

  const availabilities = [];
  const streamingInfo = streamingData.streamingInfo;

  // Delete old cache for this movie
  await pool.query('DELETE FROM availabilities WHERE tmdb_id = $1', [tmdbId]);

  // Process each country
  for (const [countryCode, platforms] of Object.entries(streamingInfo)) {
    const country = countryCode.toUpperCase();
    const countryName = getCountryName(country);

    // Process each platform in this country
    for (const [platformKey, streamOptions] of Object.entries(platforms)) {
      if (!streamOptions || streamOptions.length === 0) continue;

      const platformName = PLATFORMS[platformKey] || platformKey;
      const streamOption = streamOptions[0]; // Take first option

      // Check for French audio and subtitles
      const hasFrenchAudio = streamOption.audios?.some(a => 
        a.language === 'fra' || a.language === 'fr'
      ) || false;

      const hasFrenchSubtitles = streamOption.subtitles?.some(s => 
        s.language === 'fra' || s.language === 'fr'
      ) || false;

      // Only include if has French audio OR French subtitles
      if (hasFrenchAudio || hasFrenchSubtitles) {
        const availability = {
          tmdb_id: tmdbId,
          platform: platformName,
          country_code: country,
          country_name: countryName,
          has_french_audio: hasFrenchAudio,
          has_french_subtitles: hasFrenchSubtitles,
          streaming_url: streamOption.link || null,
          quality: streamOption.quality || 'hd'
        };

        // Insert into database
        try {
          await pool.query(
            `INSERT INTO availabilities 
            (tmdb_id, platform, country_code, country_name, has_french_audio, has_french_subtitles, streaming_url, quality, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            ON CONFLICT (tmdb_id, platform, country_code) 
            DO UPDATE SET 
              has_french_audio = $5,
              has_french_subtitles = $6,
              streaming_url = $7,
              quality = $8,
              updated_at = CURRENT_TIMESTAMP`,
            [tmdbId, platformName, country, countryName, hasFrenchAudio, hasFrenchSubtitles, streamOption.link, streamOption.quality || 'hd']
          );

          availabilities.push(availability);
        } catch (dbError) {
          console.error('Database insert error:', dbError);
        }
      }
    }
  }

  console.log(`✅ Cached ${availabilities.length} availabilities for TMDB ID ${tmdbId}`);
  return availabilities;
}

// Routes

// Search movies
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim().length < 2) {
      return res.json({ results: [] });
    }

    const searchResponse = await tmdbClient.get('/search/movie', {
      params: { query }
    });

    const results = await Promise.all(
      searchResponse.data.results.slice(0, 10).map(async (movie) => {
        // Check how many availabilities we have cached
        const countResult = await pool.query(
          'SELECT COUNT(DISTINCT country_code) as count FROM availabilities WHERE tmdb_id = $1',
          [movie.id]
        );

        return {
          tmdb_id: movie.id,
          title: movie.title,
          original_title: movie.original_title,
          year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
          poster: movie.poster_path ? `https://image.tmdb.org/t/p/w200${movie.poster_path}` : null,
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

// Get movie availability
app.get('/api/movie/:id/availability', async (req, res) => {
  try {
    const tmdb_id = parseInt(req.params.id);

    // Get movie details from TMDB
    const movieResponse = await tmdbClient.get(`/movie/${tmdb_id}`);
    const movieDetails = movieResponse.data;

    // Check cache
    const cacheCheck = await pool.query(
      'SELECT updated_at FROM availabilities WHERE tmdb_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [tmdb_id]
    );

    if (cacheCheck.rows.length > 0) {
      const cacheAge = Date.now() - new Date(cacheCheck.rows[0].updated_at).getTime();

      if (cacheAge < CACHE_DURATION) {
        console.log(`✅ Using cached data (${Math.round(cacheAge / (1000 * 60 * 60))} hours old) for "${movieDetails.title}"`);

        const cached = await pool.query(
          'SELECT * FROM availabilities WHERE tmdb_id = $1 ORDER BY platform, country_name',
          [tmdb_id]
        );

        return res.json({ availabilities: cached.rows });
      } else {
        console.log(`⏰ Cache expired (${Math.round(cacheAge / (1000 * 60 * 60 * 24))} days old), fetching fresh data...`);
      }
    }

    // Fetch fresh data
    if (!movieDetails.imdb_id) {
      console.log('No IMDB ID available for this movie');
      return res.json({ availabilities: [] });
    }

    console.log(`🔍 Fetching streaming data for "${movieDetails.title}" (IMDB: ${movieDetails.imdb_id})`);
    const streamingData = await fetchStreamingAvailability(movieDetails.imdb_id);

    if (!streamingData) {
      return res.json({ availabilities: [] });
    }

    const availabilities = await processAndCacheStreaming(tmdb_id, streamingData);
    res.json({ availabilities });

  } catch (error) {
    console.error('Availability error:', error);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Cache duration: ${CACHE_DURATION / (1000 * 60 * 60 * 24)} days`);
  console.log(`🎬 Platforms supported: ${Object.values(PLATFORMS).join(', ')}`);
});
