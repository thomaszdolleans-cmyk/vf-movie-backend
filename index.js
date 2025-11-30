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
    streaming_type VARCHAR(20) NOT NULL DEFAULT 'subscription',
    addon_name VARCHAR(100),
    has_french_audio BOOLEAN DEFAULT false,
    has_french_subtitles BOOLEAN DEFAULT false,
    streaming_url TEXT,
    quality VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tmdb_id, platform, country_code, streaming_type, addon_name)
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

// Search for a show by title to get streaming data (TMDB ID search doesn't work reliably for series)
async function searchShowByTitle(title, year, mediaType) {
  try {
    console.log(`🔍 Searching for ${mediaType} by title: "${title}" (${year})`);
    
    // Try /shows/search/filters - might support all countries
    const response = await streamingClient.get('/shows/search/filters', {
      params: {
        // Don't specify country - see if this returns all countries
        catalogs: 'netflix,prime,disney,hbo,apple,paramount,hulu,peacock',
        show_type: mediaType === 'tv' ? 'series' : 'movie',
        series_granularity: 'show',
        output_language: 'fr'
      }
    });

    const shows = response.data?.shows || [];
    
    if (shows.length > 0) {
      // Find show matching the title and year
      let bestMatch = null;
      
      for (const show of shows) {
        // Check if title matches (case insensitive)
        const showTitle = show.title.toLowerCase();
        const searchTitle = title.toLowerCase();
        
        if (showTitle === searchTitle || showTitle.includes(searchTitle) || searchTitle.includes(showTitle)) {
          const showYear = show.firstAirYear || show.releaseYear;
          
          // If year matches or no year to compare
          if (!year || showYear === year) {
            bestMatch = show;
            break;
          }
          
          // Keep as fallback if no exact year match
          if (!bestMatch) {
            bestMatch = show;
          }
        }
      }
      
      if (!bestMatch) {
        // No title match found, use first result
        bestMatch = shows[0];
      }
      
      const countriesCount = bestMatch.streamingOptions ? Object.keys(bestMatch.streamingOptions).length : 0;
      console.log(`✅ Found ${mediaType}: "${bestMatch.title}" (${bestMatch.firstAirYear || bestMatch.releaseYear})`);
      console.log(`📊 Has streamingOptions: ${!!bestMatch.streamingOptions} (${countriesCount} countries)`);
      
      // Return the whole show object (includes streamingOptions!)
      return bestMatch;
    }
    
    console.log(`❌ No ${mediaType} found with title "${title}"`);
    return null;
  } catch (error) {
    console.error('Search by filters error:', error.response?.data || error.message);
    return null;
  }
}

// Fetch streaming availability from Streaming Availability API
async function fetchStreamingAvailability(tmdbId, mediaType = 'movie', mediaDetails = null) {
  try {
    // Use the correct endpoint based on media type
    // For movies: /shows/movie/{tmdb_id}
    // For TV series: /shows/tv/{tmdb_id}
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

// Process and cache streaming data
async function processAndCacheStreaming(tmdbId, streamingData, mediaType = 'movie') {
  if (!streamingData || !streamingData.streamingOptions) {
    console.log('No streaming options available');
    return [];
  }

  const availabilities = [];
  const streamingOptions = streamingData.streamingOptions;

  // Delete old cache for this item
  await pool.query('DELETE FROM availabilities WHERE tmdb_id = $1 AND media_type = $2', [tmdbId, mediaType]);

  // Process each country
  for (const [countryCode, options] of Object.entries(streamingOptions)) {
    const country = countryCode.toUpperCase();
    const countryName = getCountryName(country);

    // Process each streaming option in this country
    for (const option of options) {
      if (!option || !option.service) continue;

      const platformKey = option.service.id;
      // Always use the main service name, never the addon name
      const platformName = PLATFORMS[platformKey] || option.service.name || platformKey;
      
      // Get streaming type (subscription, rent, buy, free, addon)
      const streamingType = option.type || 'subscription';
      
      // Get addon name if type is addon (this is the channel/addon name, not the platform)
      const addonName = streamingType === 'addon' && option.addon?.name 
        ? option.addon.name 
        : null;
      
      // FILTER: Skip Prime addons except Starz and MGM
      if (platformKey === 'prime' && streamingType === 'addon') {
        const allowedPrimeAddons = ['Starz', 'MGM+', 'MGM Plus', 'MGM', 'STARZ'];
        if (!addonName || !allowedPrimeAddons.some(allowed => addonName.toLowerCase().includes(allowed.toLowerCase()))) {
          console.log(`⏭️ Skipping Prime addon: ${addonName || 'unknown'} (not Starz or MGM)`);
          continue; // Skip this option
        }
        console.log(`✅ Keeping Prime addon: ${addonName} (Starz or MGM)`);
      }
      
      // Debug logging for addons
      if (streamingType === 'addon' && availabilities.length < 3) {
        console.log(`🔍 ADDON DEBUG:`, {
          platformKey,
          platformName,
          addonName,
          serviceId: option.service.id,
          serviceName: option.service.name,
          addonFullName: option.addon?.name
        });
      }

      // Check for French audio and subtitles with improved detection
      const hasFrenchAudio = option.audios?.some(a => {
        const lang = a.language?.toLowerCase();
        return lang === 'fra' || lang === 'fr' || lang === 'fre';
      }) || false;

      const hasFrenchSubtitles = option.subtitles?.some(s => {
        if (!s) return false;
        
        // Handle language (direct string)
        const lang = s.language ? String(s.language).toLowerCase() : '';
        
        // Handle locale (object with language property)
        const localeLanguage = s.locale?.language ? String(s.locale.language).toLowerCase() : '';
        
        // Check both language and locale.language for French
        return lang === 'fra' || lang === 'fr' || lang === 'fre' || 
               localeLanguage === 'fra' || localeLanguage === 'fr' || localeLanguage === 'fre';
      }) || false;

      // FILTER: Skip if no French audio AND no French subtitles
      if (!hasFrenchAudio && !hasFrenchSubtitles) {
        continue; // Skip this option - we only want French content
      }

      // For TV series, we need to handle seasons
      const seasons = mediaType === 'tv' && option.seasons && Array.isArray(option.seasons) 
        ? option.seasons 
        : [null]; // For movies or if no seasons, use null

      // Create an entry for EACH season (or one entry for movies)
      for (const seasonNumber of seasons) {
        // Debug logging for first few entries
        if (availabilities.length < 5) {
          console.log(`📊 ${platformName} (${streamingType}${addonName ? ` - ${addonName}` : ''}) in ${countryName}${seasonNumber ? ` - Season ${seasonNumber}` : ''}:`, {
            audios: option.audios?.map(a => a.language),
            subtitles: option.subtitles?.map(s => ({ 
              lang: s.language, 
              localeLanguage: s.locale?.language,
              closedCaptions: s.closedCaptions 
            })),
            hasFrenchAudio,
            hasFrenchSubtitles,
            type: streamingType,
            addon: addonName,
            quality: option.quality,
            season: seasonNumber,
            allSeasons: seasons
          });
        }

        const availability = {
          tmdb_id: tmdbId,
          media_type: mediaType,
          platform: platformName,
          country_code: country,
          country_name: countryName,
          streaming_type: streamingType,
          addon_name: addonName,
          season_number: seasonNumber,
          has_french_audio: hasFrenchAudio,
          has_french_subtitles: hasFrenchSubtitles,
          streaming_url: option.link || null,
          quality: option.quality || 'hd'
        };

        // Insert into database
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
            [tmdbId, mediaType, platformName, country, countryName, streamingType, addonName, seasonNumber, hasFrenchAudio, hasFrenchSubtitles, option.link, option.quality || 'hd']
          );

          availabilities.push(availability);
        } catch (dbError) {
          console.error('Database insert error:', dbError);
        }
      }
    }
  }

  console.log(`✅ Cached ${availabilities.length} availabilities for TMDB ID ${tmdbId} (${availabilities.filter(a => a.has_french_audio || a.has_french_subtitles).length} with French content)`);
  return availabilities;
}

// Routes

// Search movies AND TV series
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim().length < 2) {
      return res.json({ results: [] });
    }

    // Use multi-search to get both movies and TV series
    const searchResponse = await tmdbClient.get('/search/multi', {
      params: { query }
    });

    const results = await Promise.all(
      searchResponse.data.results
        .filter(item => item.media_type === 'movie' || item.media_type === 'tv') // Only movies and TV
        .slice(0, 10)
        .map(async (item) => {
          const isMovie = item.media_type === 'movie';
          const tmdbId = item.id;
          
          // Check how many availabilities we have cached
          const countResult = await pool.query(
            'SELECT COUNT(DISTINCT country_code) as count FROM availabilities WHERE tmdb_id = $1 AND media_type = $2',
            [tmdbId, item.media_type]
          );

          return {
            tmdb_id: tmdbId,
            media_type: item.media_type, // 'movie' or 'tv'
            title: isMovie ? item.title : item.name,
            original_title: isMovie ? item.original_title : item.original_name,
            year: isMovie 
              ? (item.release_date ? new Date(item.release_date).getFullYear() : null)
              : (item.first_air_date ? new Date(item.first_air_date).getFullYear() : null),
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null,
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

// Get list of genres for movies and TV
app.get('/api/genres', async (req, res) => {
  try {
    const [movieGenres, tvGenres] = await Promise.all([
      tmdbClient.get('/genre/movie/list'),
      tmdbClient.get('/genre/tv/list')
    ]);

    // Merge and deduplicate genres
    const allGenres = [...movieGenres.data.genres, ...tvGenres.data.genres];
    const uniqueGenres = Array.from(new Map(allGenres.map(g => [g.id, g])).values());
    
    // Sort alphabetically
    uniqueGenres.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    res.json({ genres: uniqueGenres });
  } catch (error) {
    console.error('Genres error:', error);
    res.status(500).json({ error: 'Failed to fetch genres' });
  }
});

// Discover movies and TV series with filters
app.get('/api/discover', async (req, res) => {
  try {
    const { 
      type = 'movie',      // 'movie' or 'tv'
      genre,               // Genre ID
      year,                // Year (for movies: release year, for TV: first air year)
      sort = 'popularity', // 'popularity', 'vote_average', 'release_date'
      page = 1 
    } = req.query;

    const mediaType = type === 'tv' ? 'tv' : 'movie';
    const endpoint = `/discover/${mediaType}`;

    // Build params
    const params = {
      page: parseInt(page),
      'vote_count.gte': 100, // Only shows with enough votes
    };

    // Sort options
    const sortMap = {
      'popularity': 'popularity.desc',
      'vote_average': 'vote_average.desc',
      'release_date': mediaType === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
      'title': mediaType === 'movie' ? 'title.asc' : 'name.asc'
    };
    params.sort_by = sortMap[sort] || 'popularity.desc';

    // Genre filter
    if (genre) {
      params.with_genres = genre;
    }

    // Year filter
    if (year) {
      if (mediaType === 'movie') {
        params.primary_release_year = year;
      } else {
        params.first_air_date_year = year;
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
      total_pages: Math.min(response.data.total_pages, 500), // TMDB limits to 500 pages
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
    
    // type: 'all', 'movie', 'tv'
    // time: 'day', 'week'
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
    const mediaType = req.params.type; // 'movie' or 'tv'

    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return res.status(400).json({ error: 'Invalid media type. Must be "movie" or "tv"' });
    }

    // Get media details from TMDB
    const endpoint = mediaType === 'movie' ? `/movie/${tmdb_id}` : `/tv/${tmdb_id}`;
    const mediaResponse = await tmdbClient.get(endpoint);
    const mediaDetails = mediaResponse.data;

    // Check cache
    const cacheCheck = await pool.query(
      'SELECT updated_at FROM availabilities WHERE tmdb_id = $1 AND media_type = $2 ORDER BY updated_at DESC LIMIT 1',
      [tmdb_id, mediaType]
    );

    if (cacheCheck.rows.length > 0) {
      const cacheAge = Date.now() - new Date(cacheCheck.rows[0].updated_at).getTime();

      if (cacheAge < CACHE_DURATION) {
        const title = mediaType === 'movie' ? mediaDetails.title : mediaDetails.name;
        console.log(`✅ Using cached data (${Math.round(cacheAge / (1000 * 60 * 60))} hours old) for "${title}"`);

        const cached = await pool.query(
          'SELECT * FROM availabilities WHERE tmdb_id = $1 AND media_type = $2 ORDER BY platform, country_name, season_number',
          [tmdb_id, mediaType]
        );

        return res.json({ 
          availabilities: cached.rows,
          media: {
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
          }
        });
      } else {
        console.log(`⏰ Cache expired (${Math.round(cacheAge / (1000 * 60 * 60 * 24))} days old), fetching fresh data...`);
      }
    }

    // Fetch fresh data using TMDB ID
    const title = mediaType === 'movie' ? mediaDetails.title : mediaDetails.name;
    console.log(`🔍 Fetching streaming data for "${title}" (TMDB ID: ${tmdb_id}, Type: ${mediaType})`);
    const streamingData = await fetchStreamingAvailability(tmdb_id, mediaType, mediaDetails);

    if (!streamingData) {
      return res.json({ 
        availabilities: [],
        media: {
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
        }
      });
    }

    const availabilities = await processAndCacheStreaming(tmdb_id, streamingData, mediaType);
    res.json({ 
      availabilities,
      media: {
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
      }
    });

  } catch (error) {
    console.error('Availability error:', error);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

// Backwards compatibility: redirect old movie endpoint to new media endpoint
app.get('/api/movie/:id/availability', async (req, res) => {
  return res.redirect(308, `/api/media/movie/${req.params.id}/availability`);
});

// Debug endpoint - test search by title to see what data is returned
app.get('/api/debug-search/:tmdb_id', async (req, res) => {
  try {
    const tmdb_id = parseInt(req.params.tmdb_id);
    
    console.log(`🔍 Testing search for TMDB ID: ${tmdb_id}`);
    
    // First, get the series details from TMDB to get the title
    const tmdbResponse = await tmdbClient.get(`/tv/${tmdb_id}`);
    const seriesDetails = tmdbResponse.data;
    const title = seriesDetails.name;
    const year = seriesDetails.first_air_date 
      ? new Date(seriesDetails.first_air_date).getFullYear() 
      : null;
    
    console.log(`📺 Series from TMDB: "${title}" (${year})`);
    
    // Try filters endpoint without country
    const response = await streamingClient.get('/shows/search/filters', {
      params: {
        catalogs: 'netflix,prime,disney,hbo,apple,paramount,hulu,peacock',
        show_type: 'series',
        series_granularity: 'show',
        output_language: 'fr'
      }
    });

    const shows = response.data?.shows || [];
    
    if (shows.length === 0) {
      return res.json({
        found: false,
        tmdb_id,
        title_searched: title,
        year,
        message: 'No shows found with this title'
      });
    }
    
    // Find best match by year
    let bestMatch = shows[0];
    if (year) {
      for (const show of shows) {
        const showYear = show.firstAirYear || show.releaseYear;
        if (showYear === year) {
          bestMatch = show;
          break;
        }
      }
    }
    
    res.json({
      found: true,
      tmdb_id_input: tmdb_id,
      title_searched: title,
      year_searched: year,
      total_results: shows.length,
      best_match: {
        title: bestMatch.title,
        year: bestMatch.firstAirYear || bestMatch.releaseYear,
        id: bestMatch.id,
        tmdbId: bestMatch.tmdbId,
        imdbId: bestMatch.imdbId,
        streamingOptions: bestMatch.streamingOptions ? Object.keys(bestMatch.streamingOptions) : [],
        total_countries: bestMatch.streamingOptions ? Object.keys(bestMatch.streamingOptions).length : 0,
        has_data: !!bestMatch.streamingOptions
      },
      note: "✅ Search by title works! Data can be used directly."
    });
  } catch (error) {
    console.error('Search debug error:', error);
    res.status(500).json({ 
      error: error.message,
      response_data: error.response?.data 
    });
  }
});

// Debug endpoint - check series structure
app.get('/api/debug-series/:tmdb_id', async (req, res) => {
  try {
    const tmdb_id = parseInt(req.params.tmdb_id);
    
    console.log(`🔍 DEBUG: Fetching series data for TMDB ID: ${tmdb_id}`);
    
    // Step 1: Get series details from TMDB
    console.log(`Step 1: Getting series details from TMDB...`);
    const tmdbResponse = await tmdbClient.get(`/tv/${tmdb_id}`);
    const seriesDetails = tmdbResponse.data;
    const title = seriesDetails.name;
    const year = seriesDetails.first_air_date 
      ? new Date(seriesDetails.first_air_date).getFullYear() 
      : null;
    
    console.log(`📺 Series: "${title}" (${year})`);
    
    // Step 2: Search by title
    console.log(`Step 2: Searching by title...`);
    const showData = await searchShowByTitle(title, year, 'tv');
    
    if (!showData) {
      return res.json({
        error: 'Search failed',
        tmdb_id,
        title,
        year,
        step: 'search_failed',
        suggestion: 'Series not found in Streaming Availability API'
      });
    }
    
    console.log(`✅ Found series data`);
    
    // Step 3: Show sample data
    const streamingOptions = showData.streamingOptions || {};
    
    if (Object.keys(streamingOptions).length === 0) {
      return res.json({
        error: 'No streaming options',
        tmdb_id,
        title,
        show_id: showData.id,
        step: 'no_streaming_options',
        suggestion: 'Series found but no streaming availability data'
      });
    }
    
    const sampleOptions = [];
    for (const [country, options] of Object.entries(streamingOptions)) {
      if (sampleOptions.length >= 5) break;
      
      for (const option of options.slice(0, 2)) {
        sampleOptions.push({
          country,
          platform: option.service?.name,
          type: option.type,
          seasons: option.seasons,
          has_seasons_array: Array.isArray(option.seasons),
          seasons_length: option.seasons?.length || 0
        });
        if (sampleOptions.length >= 5) break;
      }
    }
    
    res.json({
      success: true,
      tmdb_id,
      title,
      year,
      show_id: showData.id,
      total_countries: Object.keys(streamingOptions).length,
      sample_options: sampleOptions,
      note: "Success! Series found by title search with streaming data."
    });
  } catch (error) {
    console.error('Debug series error:', error);
    res.status(500).json({ 
      error: error.message, 
      stack: error.stack,
      response_data: error.response?.data 
    });
  }
});

// Test endpoint - try different series endpoint formats
app.get('/api/test-series-endpoints/:tmdb_id', async (req, res) => {
  try {
    const tmdb_id = req.params.tmdb_id;
    const results = {};
    
    // Test 1: /shows/tv/{tmdb_id} (like movies but tv)
    try {
      console.log(`Test 1: /shows/tv/${tmdb_id}`);
      const r1 = await streamingClient.get(`/shows/tv/${tmdb_id}`, {
        params: { output_language: 'fr', series_granularity: 'show' }
      });
      results.test1_shows_tv = {
        success: true,
        countries: r1.data.streamingOptions ? Object.keys(r1.data.streamingOptions).length : 0
      };
    } catch (e) {
      results.test1_shows_tv = { success: false, error: e.response?.status || e.message };
    }
    
    // Test 2: /shows/series/tv/{tmdb_id}
    try {
      console.log(`Test 2: /shows/series/tv/${tmdb_id}`);
      const r2 = await streamingClient.get(`/shows/series/tv/${tmdb_id}`, {
        params: { output_language: 'fr', series_granularity: 'show' }
      });
      results.test2_shows_series_tv = {
        success: true,
        countries: r2.data.streamingOptions ? Object.keys(r2.data.streamingOptions).length : 0
      };
    } catch (e) {
      results.test2_shows_series_tv = { success: false, error: e.response?.status || e.message };
    }
    
    // Test 3: /shows/{tmdb_id} with type param
    try {
      console.log(`Test 3: /shows/${tmdb_id}`);
      const r3 = await streamingClient.get(`/shows/${tmdb_id}`, {
        params: { output_language: 'fr', series_granularity: 'show', show_type: 'series' }
      });
      results.test3_shows_with_type = {
        success: true,
        countries: r3.data.streamingOptions ? Object.keys(r3.data.streamingOptions).length : 0
      };
    } catch (e) {
      results.test3_shows_with_type = { success: false, error: e.response?.status || e.message };
    }
    
    // Test 4: /shows/series/{tmdb_id} (direct number)
    try {
      console.log(`Test 4: /shows/series/${tmdb_id}`);
      const r4 = await streamingClient.get(`/shows/series/${tmdb_id}`, {
        params: { output_language: 'fr', series_granularity: 'show' }
      });
      results.test4_shows_series_number = {
        success: true,
        countries: r4.data.streamingOptions ? Object.keys(r4.data.streamingOptions).length : 0
      };
    } catch (e) {
      results.test4_shows_series_number = { success: false, error: e.response?.status || e.message };
    }
    
    res.json({
      tmdb_id,
      results,
      note: "Testing different endpoint formats to find one that works like /shows/movie/{id}"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint - try fetching series directly with API ID
app.get('/api/test-series-direct/:api_id', async (req, res) => {
  try {
    const api_id = req.params.api_id;
    
    console.log(`🧪 Testing direct series fetch with API ID: ${api_id}`);
    
    const response = await streamingClient.get(`/shows/series/${api_id}`, {
      params: {
        series_granularity: 'show',
        output_language: 'fr'
      }
    });
    
    const data = response.data;
    const countriesCount = data.streamingOptions ? Object.keys(data.streamingOptions).length : 0;
    
    res.json({
      success: true,
      api_id,
      title: data.title,
      total_countries: countriesCount,
      countries: data.streamingOptions ? Object.keys(data.streamingOptions) : [],
      note: "If this works, we can use direct fetch instead of search!"
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
  }
});

// Debug endpoint - check duplicates
app.get('/api/debug-duplicates/:tmdb_id', async (req, res) => {
  try {
    const tmdb_id = parseInt(req.params.tmdb_id);
    
    // Get all entries for this movie
    const result = await pool.query(
      `SELECT tmdb_id, platform, country_code, country_name, streaming_type, addon_name, 
              quality, has_french_audio, has_french_subtitles, streaming_url, 
              created_at, updated_at
       FROM availabilities 
       WHERE tmdb_id = $1 
       ORDER BY country_code, platform, streaming_type, addon_name`,
      [tmdb_id]
    );
    
    // Find duplicates (same country, platform, type, addon)
    const seen = new Map();
    const duplicates = [];
    
    result.rows.forEach(row => {
      const key = `${row.country_code}-${row.platform}-${row.streaming_type}-${row.addon_name}`;
      if (seen.has(key)) {
        duplicates.push({
          key,
          first: seen.get(key),
          duplicate: row
        });
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
    console.error('Debug duplicates error:', error);
    res.status(500).json({ error: error.message });
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

// RESET DATABASE ENDPOINT (for fixing table structure)
app.get('/api/reset-database', async (req, res) => {
  try {
    console.log('🔄 Dropping old table...');
    await pool.query('DROP TABLE IF EXISTS availabilities');
    console.log('✅ Old table dropped!');
    
    console.log('🔨 Creating new table with correct structure...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS availabilities (
        id SERIAL PRIMARY KEY,
        tmdb_id INTEGER NOT NULL,
        media_type VARCHAR(10) NOT NULL DEFAULT 'movie',
        platform VARCHAR(50) NOT NULL,
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
    `);
    
    console.log('✅ New table created successfully with streaming_type and addon_name support!');
    res.json({ 
      success: true, 
      message: 'Database reset successfully! Table recreated with streaming_type and addon_name columns for VOD and addon support.' 
    });
  } catch (error) {
    console.error('❌ Reset error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// TEST ENDPOINT - Test Streaming Availability API
app.get('/api/test-streaming-api', async (req, res) => {
  try {
    // Test with Inception (TMDB ID: 27205)
    const testTmdbId = '27205';
    
    console.log(`🧪 Testing Streaming Availability API with TMDB ID: ${testTmdbId}`);
    
    // Check if API key is configured
    if (!process.env.RAPIDAPI_KEY) {
      return res.json({
        success: false,
        error: 'RAPIDAPI_KEY is not configured in environment variables',
        configured: {
          TMDB_API_KEY: !!process.env.TMDB_API_KEY,
          RAPIDAPI_KEY: !!process.env.RAPIDAPI_KEY,
          DATABASE_URL: !!process.env.DATABASE_URL
        }
      });
    }

    const response = await streamingClient.get(`/shows/movie/${testTmdbId}`, {
      params: {
        series_granularity: 'show',
        output_language: 'fr'
      }
    });

    const platformCount = Object.keys(response.data.streamingOptions || {}).length;
    const platforms = {};
    
    // Count platforms
    if (response.data.streamingOptions) {
      for (const [country, countryPlatforms] of Object.entries(response.data.streamingOptions)) {
        for (const platformData of countryPlatforms) {
          const platform = platformData.service?.id || 'unknown';
          platforms[platform] = (platforms[platform] || 0) + 1;
        }
      }
    }

    res.json({
      success: true,
      message: 'API is working!',
      test_movie: `Inception (TMDB ID: ${testTmdbId})`,
      countries_found: platformCount,
      platforms_found: platforms,
      sample_data: response.data.streamingOptions ? Object.keys(response.data.streamingOptions).slice(0, 5) : [],
      api_key_configured: true,
      full_response_sample: response.data.streamingOptions ? 
        Object.entries(response.data.streamingOptions).slice(0, 1).map(([country, options]) => ({
          country,
          options: options.slice(0, 2)
        })) : []
    });

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      error_details: error.response?.data,
      api_key_configured: !!process.env.RAPIDAPI_KEY
    });
  }
});

// DEBUG ENDPOINT - Inspect subtitle data for a specific movie
app.get('/api/debug-subtitles/:tmdb_id', async (req, res) => {
  try {
    const tmdbId = req.params.tmdb_id;
    
    console.log(`🔍 Debug: Fetching subtitle data for TMDB ID ${tmdbId}`);
    
    const response = await streamingClient.get(`/shows/movie/${tmdbId}`, {
      params: {
        series_granularity: 'show',
        output_language: 'fr'
      }
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
    res.status(500).json({
      error: error.message,
      details: error.response?.data
    });
  }
});

// DEBUG ENDPOINT - Check addon details
app.get('/api/debug-addons/:tmdb_id', async (req, res) => {
  try {
    const tmdbId = req.params.tmdb_id;
    
    console.log(`🔍 Debug: Fetching addon details for TMDB ID ${tmdbId}`);
    
    const response = await streamingClient.get(`/shows/movie/${tmdbId}`, {
      params: {
        series_granularity: 'show',
        output_language: 'fr'
      }
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
      addon_samples: addonSamples.slice(0, 5),
      note: "Look for 'addon' field to see addon name"
    });

  } catch (error) {
    res.status(500).json({
      error: error.message,
      details: error.response?.data
    });
  }
});
app.get('/api/debug-types/:tmdb_id', async (req, res) => {
  try {
    const tmdbId = req.params.tmdb_id;
    
    console.log(`🔍 Debug: Fetching streaming types for TMDB ID ${tmdbId}`);
    
    const response = await streamingClient.get(`/shows/movie/${tmdbId}`, {
      params: {
        series_granularity: 'show',
        output_language: 'fr'
      }
    });

    const typesSummary = {
      subscription: 0,
      rent: 0,
      buy: 0,
      free: 0,
      addon: 0,
      unknown: 0,
      samples: []
    };
    
    if (response.data.streamingOptions) {
      for (const [country, options] of Object.entries(response.data.streamingOptions)) {
        for (const option of options) {
          const type = option.type || 'unknown';
          typesSummary[type] = (typesSummary[type] || 0) + 1;
          
          if (typesSummary.samples.length < 10) {
            typesSummary.samples.push({
              country,
              platform: option.service?.name || option.service?.id,
              type: option.type,
              hasType: !!option.type,
              link: option.link
            });
          }
        }
      }
    }

    res.json({
      tmdb_id: tmdbId,
      total_options: Object.values(response.data.streamingOptions || {}).flat().length,
      types_breakdown: typesSummary,
      note: "If 'unknown' is high, the API might not provide 'type' field"
    });

  } catch (error) {
    res.status(500).json({
      error: error.message,
      details: error.response?.data
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
  console.log(`🎬 Platforms supported: ${Object.values(PLATFORMS).join(', ')}`);
});
