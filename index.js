const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
  try {
    console.log('Initializing database...');
    await pool.query(`CREATE TABLE IF NOT EXISTS movies (id INTEGER PRIMARY KEY, title VARCHAR(500) NOT NULL, original_title VARCHAR(500), release_year INTEGER, tmdb_data JSONB, last_updated TIMESTAMP DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS availabilities (id SERIAL PRIMARY KEY, movie_id INTEGER NOT NULL, country_code VARCHAR(2) NOT NULL, platform VARCHAR(50) NOT NULL, has_french_audio BOOLEAN DEFAULT FALSE, has_french_subtitles BOOLEAN DEFAULT FALSE, netflix_id VARCHAR(50), last_checked TIMESTAMP DEFAULT NOW(), UNIQUE(movie_id, country_code, platform));`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_availabilities_movie_id ON availabilities(movie_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_availabilities_french_audio ON availabilities(movie_id, has_french_audio);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);`);
    console.log('✅ Database initialized!');
  } catch (error) {
    console.error('❌ Database init failed:', error.message);
  }
}

initDatabase();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const tmdbClient = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  params: { api_key: process.env.TMDB_API_KEY }
});

const unogsClient = axios.create({
  baseURL: 'https://unogsng.p.rapidapi.com',
  headers: {
    'X-RapidAPI-Key': process.env.UNOGS_API_KEY,
    'X-RapidAPI-Host': 'unogsng.p.rapidapi.com'
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const searchQuery = req.query.query;
    if (!searchQuery || searchQuery.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const tmdbResponse = await tmdbClient.get('/search/movie', {
      params: { query: searchQuery, language: 'fr-FR' }
    });

    const movies = await Promise.all(
      tmdbResponse.data.results.slice(0, 10).map(async (movie) => {
        const availabilityCount = await pool.query(
          'SELECT COUNT(DISTINCT country_code) as count FROM availabilities WHERE movie_id = $1 AND has_french_audio = true',
          [movie.id]
        );

        return {
          tmdb_id: movie.id,
          title: movie.title,
          original_title: movie.original_title,
          year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
          poster: movie.poster_path ? `https://image.tmdb.org/t/p/w200${movie.poster_path}` : null,
          availability_count: parseInt(availabilityCount.rows[0].count)
        };
      })
    );

    res.json({ results: movies });
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

app.get('/api/movie/:tmdb_id/availability', async (req, res) => {
  try {
    const { tmdb_id } = req.params;
    const { audio_filter } = req.query;

    const movieDetails = await getOrCreateMovie(tmdb_id);

    // Always fetch fresh data - no cache
    console.log('Fetching fresh data from uNoGS...');
    const availabilities = await fetchAndCacheAvailability(tmdb_id, movieDetails);

    let filtered = availabilities;
    if (audio_filter === 'vf') {
      filtered = availabilities.filter(a => a.has_french_audio);
    } else if (audio_filter === 'vostfr') {
      filtered = availabilities.filter(a => a.has_french_subtitles);
    }

    const formattedAvailabilities = filtered.map(a => ({
      country_code: a.country_code,
      country_name: getCountryName(a.country_code),
      platform: a.platform,
      has_french_audio: a.has_french_audio,
      has_french_subtitles: a.has_french_subtitles,
      netflix_url: a.netflix_id ? `https://www.netflix.com/title/${a.netflix_id}` : null,
      last_checked: a.last_checked
    }));

    res.json({
      movie: movieDetails,
      availabilities: formattedAvailabilities,
      total_countries: formattedAvailabilities.length
    });

  } catch (error) {
    console.error('Availability error:', error.message);
    res.status(500).json({ error: 'Failed to get availability', details: error.message });
  }
});

async function getOrCreateMovie(tmdb_id) {
  const existing = await pool.query('SELECT * FROM movies WHERE id = $1', [tmdb_id]);
  
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const tmdbMovie = await tmdbClient.get(`/movie/${tmdb_id}`, {
    params: { language: 'fr-FR' }
  });

  const movie = tmdbMovie.data;

  await pool.query(
    `INSERT INTO movies (id, title, original_title, release_year, tmdb_data, last_updated)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET tmdb_data = $5, last_updated = NOW()`,
    [
      movie.id,
      movie.title,
      movie.original_title,
      movie.release_date ? new Date(movie.release_date).getFullYear() : null,
      JSON.stringify(movie)
    ]
  );

  return {
    id: movie.id,
    title: movie.title,
    original_title: movie.original_title,
    release_year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
    poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null
  };
}

async function fetchAndCacheAvailability(tmdb_id, movieDetails) {
  try {
    console.log(`Searching uNoGS for: ${movieDetails.title}`);
    
    let searchResponse = await unogsClient.get('/search', {
      params: {
        query: movieDetails.title,
        type: 'movie',
        limit: 10
      }
    });

    if (!searchResponse.data?.results || searchResponse.data.results.length === 0) {
      console.log(`No results with French title, trying original: ${movieDetails.original_title}`);
      searchResponse = await unogsClient.get('/search', {
        params: {
          query: movieDetails.original_title,
          type: 'movie',
          limit: 10
        }
      });
    }

    const availabilities = [];

    if (searchResponse.data && searchResponse.data.results && searchResponse.data.results.length > 0) {
      console.log(`uNoGS returned ${searchResponse.data.results.length} results`);
      
      let bestMatch = null;
      
      // First: Try exact title match with valid year
      if (movieDetails.release_year) {
        bestMatch = searchResponse.data.results.find(result => {
          const titleMatch = result.title?.toLowerCase() === movieDetails.title.toLowerCase() ||
                            result.title?.toLowerCase() === movieDetails.original_title?.toLowerCase();
          const resultYear = result.year || result.filmyear || 0;
          const yearDiff = Math.abs(resultYear - movieDetails.release_year);
          return titleMatch && yearDiff <= 1 && resultYear !== 0;
        });
        
        if (bestMatch) {
          console.log(`✅ Found exact title and year match: ${bestMatch.title} (${bestMatch.year})`);
        }
      }
      
      // Second: Try to find any result with matching year (within 1 year)
      if (!bestMatch && movieDetails.release_year) {
        bestMatch = searchResponse.data.results.find(result => {
          const resultYear = result.year || result.filmyear || 0;
          const yearDiff = Math.abs(resultYear - movieDetails.release_year);
          return yearDiff <= 1 && resultYear !== 0;
        });
        
        if (bestMatch) {
          console.log(`✅ Found match by year: ${bestMatch.title} (${bestMatch.year})`);
        }
      }
      
      // Third: Fallback to first result but log warning
      if (!bestMatch) {
        bestMatch = searchResponse.data.results[0];
        const resultYear = bestMatch.year || bestMatch.filmyear || 0;
        console.log(`⚠️ Using first result (may not be accurate): ${bestMatch.title} (${resultYear})`);
        
        if (movieDetails.release_year && resultYear !== 0) {
          const yearDiff = Math.abs(resultYear - movieDetails.release_year);
          if (yearDiff > 1) {
            console.log(`⚠️ Year mismatch! TMDB: ${movieDetails.release_year}, uNoGS: ${resultYear}`);
            console.log(`⚠️ This is likely a different movie!`);
            // Return empty results for wrong movie
            return [];
          }
        }
        
        if (resultYear === 0) {
          console.log(`⚠️ uNoGS result has no year information - accuracy cannot be verified`);
        }
      }

      const netflixId = bestMatch.nfid || bestMatch.id;
      console.log(`Using Netflix ID: ${netflixId} for title: ${bestMatch.title} (${bestMatch.year || 'unknown year'})`);

      // Get countries and audio/subtitle details using titlecountries endpoint
      try {
        console.log('Fetching title countries...');
        const countriesResponse = await unogsClient.get('/titlecountries', {
          params: { netflixid: netflixId }
        });

        console.log('Countries response received');

        if (countriesResponse.data && Array.isArray(countriesResponse.data.results)) {
          const countryResults = countriesResponse.data.results;
          
          console.log(`Found ${countryResults.length} countries with availability`);

          for (const countryData of countryResults) {
            const countryCode = countryData.cc;
            const audioString = countryData.audio || '';
            const subtitleString = countryData.subtitle || '';
            
            // Check if French audio or subtitles are available in THIS country
            const hasFrenchAudio = audioString.toLowerCase().includes('french');
            const hasFrenchSubs = subtitleString.toLowerCase().includes('french');

            try {
              await pool.query(
                `INSERT INTO availabilities (movie_id, country_code, platform, has_french_audio, has_french_subtitles, netflix_id, last_checked)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (movie_id, country_code, platform) 
                 DO UPDATE SET has_french_audio = $4, has_french_subtitles = $5, netflix_id = $6, last_checked = NOW()`,
                [tmdb_id, countryCode, 'netflix', hasFrenchAudio, hasFrenchSubs, netflixId]
              );

              availabilities.push({
                country_code: countryCode,
                has_french_audio: hasFrenchAudio,
                has_french_subtitles: hasFrenchSubs,
                netflix_id: netflixId,
                platform: 'netflix'
              });
            } catch (dbError) {
              console.error(`Failed to insert country ${countryCode}:`, dbError.message);
            }
          }
          
          console.log(`Cached ${availabilities.length} country availabilities`);
        }
      } catch (countryError) {
        console.error('Error fetching titlecountries:', countryError.message);
        if (countryError.response) {
          console.error('Error status:', countryError.response.status);
        }
      }
    } else {
      console.log('No results found on uNoGS for this title');
    }

    return availabilities;
  } catch (error) {
    console.error('uNoGS fetch error:', error.message);
    if (error.response) {
      console.error('uNoGS error status:', error.response.status);
    }
    return [];
  }
}

function getCountryName(code) {
  const countries = {
    'AD': 'Andorre', 'AE': 'Émirats arabes unis', 'AF': 'Afghanistan', 'AG': 'Antigua-et-Barbuda',
    'AI': 'Anguilla', 'AL': 'Albanie', 'AM': 'Arménie', 'AO': 'Angola', 'AQ': 'Antarctique',
    'AR': 'Argentine', 'AS': 'Samoa américaines', 'AT': 'Autriche', 'AU': 'Australie', 
    'AW': 'Aruba', 'AX': 'Îles Åland', 'AZ': 'Azerbaïdjan', 'BA': 'Bosnie-Herzégovine',
    'BB': 'Barbade', 'BD': 'Bangladesh', 'BE': 'Belgique', 'BF': 'Burkina Faso', 
    'BG': 'Bulgarie', 'BH': 'Bahreïn', 'BI': 'Burundi', 'BJ': 'Bénin', 'BL': 'Saint-Barthélemy',
    'BM': 'Bermudes', 'BN': 'Brunei', 'BO': 'Bolivie', 'BQ': 'Pays-Bas caribéens',
    'BR': 'Brésil', 'BS': 'Bahamas', 'BT': 'Bhoutan', 'BV': 'Île Bouvet', 'BW': 'Botswana',
    'BY': 'Biélorussie', 'BZ': 'Belize', 'CA': 'Canada', 'CC': 'Îles Cocos', 'CD': 'RD Congo',
    'CF': 'République centrafricaine', 'CG': 'Congo', 'CH': 'Suisse', 'CI': 'Côte d\'Ivoire',
    'CK': 'Îles Cook', 'CL': 'Chili', 'CM': 'Cameroun', 'CN': 'Chine', 'CO': 'Colombie',
    'CR': 'Costa Rica', 'CU': 'Cuba', 'CV': 'Cap-Vert', 'CW': 'Curaçao', 'CX': 'Île Christmas',
    'CY': 'Chypre', 'CZ': 'République tchèque', 'DE': 'Allemagne', 'DJ': 'Djibouti',
    'DK': 'Danemark', 'DM': 'Dominique', 'DO': 'République dominicaine', 'DZ': 'Algérie',
    'EC': 'Équateur', 'EE': 'Estonie', 'EG': 'Égypte', 'EH': 'Sahara occidental', 
    'ER': 'Érythrée', 'ES': 'Espagne', 'ET': 'Éthiopie', 'FI': 'Finlande', 'FJ': 'Fidji',
    'FK': 'Îles Malouines', 'FM': 'Micronésie', 'FO': 'Îles Féroé', 'FR': 'France',
    'GA': 'Gabon', 'GB': 'Royaume-Uni', 'GD': 'Grenade', 'GE': 'Géorgie', 'GF': 'Guyane',
    'GG': 'Guernesey', 'GH': 'Ghana', 'GI': 'Gibraltar', 'GL': 'Groenland', 'GM': 'Gambie',
    'GN': 'Guinée', 'GP': 'Guadeloupe', 'GQ': 'Guinée équatoriale', 'GR': 'Grèce',
    'GS': 'Géorgie du Sud', 'GT': 'Guatemala', 'GU': 'Guam', 'GW': 'Guinée-Bissau',
    'GY': 'Guyana', 'HK': 'Hong Kong', 'HM': 'Îles Heard-et-MacDonald', 'HN': 'Honduras',
    'HR': 'Croatie', 'HT': 'Haïti', 'HU': 'Hongrie', 'ID': 'Indonésie', 'IE': 'Irlande',
    'IL': 'Israël', 'IM': 'Île de Man', 'IN': 'Inde', 'IO': 'Territoire britannique de l\'océan Indien',
    'IQ': 'Irak', 'IR': 'Iran', 'IS': 'Islande', 'IT': 'Italie', 'JE': 'Jersey', 'JM': 'Jamaïque',
    'JO': 'Jordanie', 'JP': 'Japon', 'KE': 'Kenya', 'KG': 'Kirghizistan', 'KH': 'Cambodge',
    'KI': 'Kiribati', 'KM': 'Comores', 'KN': 'Saint-Christophe-et-Niévès', 'KP': 'Corée du Nord',
    'KR': 'Corée du Sud', 'KW': 'Koweït', 'KY': 'Îles Caïmans', 'KZ': 'Kazakhstan', 'LA': 'Laos',
    'LB': 'Liban', 'LC': 'Sainte-Lucie', 'LI': 'Liechtenstein', 'LK': 'Sri Lanka', 'LR': 'Liberia',
    'LS': 'Lesotho', 'LT': 'Lituanie', 'LU': 'Luxembourg', 'LV': 'Lettonie', 'LY': 'Libye',
    'MA': 'Maroc', 'MC': 'Monaco', 'MD': 'Moldavie', 'ME': 'Monténégro', 'MF': 'Saint-Martin',
    'MG': 'Madagascar', 'MH': 'Îles Marshall', 'MK': 'Macédoine du Nord', 'ML': 'Mali',
    'MM': 'Birmanie', 'MN': 'Mongolie', 'MO': 'Macao', 'MP': 'Îles Mariannes du Nord',
    'MQ': 'Martinique', 'MR': 'Mauritanie', 'MS': 'Montserrat', 'MT': 'Malte', 'MU': 'Maurice',
    'MV': 'Maldives', 'MW': 'Malawi', 'MX': 'Mexique', 'MY': 'Malaisie', 'MZ': 'Mozambique',
    'NA': 'Namibie', 'NC': 'Nouvelle-Calédonie', 'NE': 'Niger', 'NF': 'Île Norfolk',
    'NG': 'Nigeria', 'NI': 'Nicaragua', 'NL': 'Pays-Bas', 'NO': 'Norvège', 'NP': 'Népal',
    'NR': 'Nauru', 'NU': 'Niue', 'NZ': 'Nouvelle-Zélande', 'OM': 'Oman', 'PA': 'Panama',
    'PE': 'Pérou', 'PF': 'Polynésie française', 'PG': 'Papouasie-Nouvelle-Guinée', 
    'PH': 'Philippines', 'PK': 'Pakistan', 'PL': 'Pologne', 'PM': 'Saint-Pierre-et-Miquelon',
    'PN': 'Îles Pitcairn', 'PR': 'Porto Rico', 'PS': 'Palestine', 'PT': 'Portugal',
    'PW': 'Palaos', 'PY': 'Paraguay', 'QA': 'Qatar', 'RE': 'La Réunion', 'RO': 'Roumanie',
    'RS': 'Serbie', 'RU': 'Russie', 'RW': 'Rwanda', 'SA': 'Arabie saoudite', 
    'SB': 'Îles Salomon', 'SC': 'Seychelles', 'SD': 'Soudan', 'SE': 'Suède', 'SG': 'Singapour',
    'SH': 'Sainte-Hélène', 'SI': 'Slovénie', 'SJ': 'Svalbard et Jan Mayen', 'SK': 'Slovaquie',
    'SL': 'Sierra Leone', 'SM': 'Saint-Marin', 'SN': 'Sénégal', 'SO': 'Somalie', 
    'SR': 'Suriname', 'SS': 'Soudan du Sud', 'ST': 'Sao Tomé-et-Principe', 'SV': 'Salvador',
    'SX': 'Saint-Martin', 'SY': 'Syrie', 'SZ': 'Eswatini', 'TC': 'Îles Turques-et-Caïques',
    'TD': 'Tchad', 'TF': 'Terres australes françaises', 'TG': 'Togo', 'TH': 'Thaïlande',
    'TJ': 'Tadjikistan', 'TK': 'Tokelau', 'TL': 'Timor oriental', 'TM': 'Turkménistan',
    'TN': 'Tunisie', 'TO': 'Tonga', 'TR': 'Turquie', 'TT': 'Trinité-et-Tobago', 'TV': 'Tuvalu',
    'TW': 'Taïwan', 'TZ': 'Tanzanie', 'UA': 'Ukraine', 'UG': 'Ouganda', 
    'UM': 'Îles mineures éloignées des États-Unis', 'US': 'États-Unis', 'UY': 'Uruguay',
    'UZ': 'Ouzbékistan', 'VA': 'Vatican', 'VC': 'Saint-Vincent-et-les-Grenadines',
    'VE': 'Venezuela', 'VG': 'Îles Vierges britanniques', 'VI': 'Îles Vierges des États-Unis',
    'VN': 'Viêt Nam', 'VU': 'Vanuatu', 'WF': 'Wallis-et-Futuna', 'WS': 'Samoa', 'YE': 'Yémen',
    'YT': 'Mayotte', 'ZA': 'Afrique du Sud', 'ZM': 'Zambie', 'ZW': 'Zimbabwe'
  };
  return countries[code] || code;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ENDPOINT DE TEST - TEMPORAIRE
app.get('/api/test-unogs/:netflixid', async (req, res) => {
  try {
    const netflixId = req.params.netflixid;
    console.log(`Testing uNoGS for Netflix ID: ${netflixId}`);
    
    // Test titlecountries endpoint
    const countriesResponse = await unogsClient.get('/titlecountries', {
      params: { netflixid: netflixId }
    });
    
    console.log('Title Countries response:', JSON.stringify(countriesResponse.data, null, 2));
    
    res.json({
      success: true,
      netflixId: netflixId,
      endpoint: '/titlecountries',
      data: countriesResponse.data
    });
    
  } catch (error) {
    console.error('Test error:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

// VIDER TOUT LE CACHE
app.get('/api/clear-all-cache', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM availabilities');
    res.json({ 
      success: true, 
      message: 'All cache cleared',
      rowsDeleted: result.rowCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VIDER LE CACHE D'UN FILM SPÉCIFIQUE
app.get('/api/clear-cache/:tmdb_id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM availabilities WHERE movie_id = $1', [req.params.tmdb_id]);
    res.json({ 
      success: true, 
      message: 'Cache cleared for this movie',
      rowsDeleted: result.rowCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 VF Movie Finder API running on port ${PORT}`);
});

module.exports = app;
