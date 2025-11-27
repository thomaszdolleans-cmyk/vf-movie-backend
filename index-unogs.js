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

// Auto-create tables on startup
async function initDatabase() {
  try {
    console.log('Initializing database...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        original_title VARCHAR(500),
        release_year INTEGER,
        tmdb_data JSONB,
        last_updated TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS availabilities (
        id SERIAL PRIMARY KEY,
        movie_id INTEGER NOT NULL,
        country_code VARCHAR(2) NOT NULL,
        platform VARCHAR(50) NOT NULL,
        has_french_audio BOOLEAN DEFAULT FALSE,
        has_french_subtitles BOOLEAN DEFAULT FALSE,
        netflix_id VARCHAR(50),
        last_checked TIMESTAMP DEFAULT NOW(),
        UNIQUE(movie_id, country_code, platform)
      );
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_availabilities_movie_id ON availabilities(movie_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_availabilities_french_audio ON availabilities(movie_id, has_french_audio);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
    `);
    
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

// uNoGSng API client
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

    console.log(`Searching for: "${searchQuery}"`);

    const tmdbResponse = await tmdbClient.get('/search/movie', {
      params: { query: searchQuery, language: 'fr-FR' }
    });

    console.log(`TMDB found ${tmdbResponse.data.results.length} results`);

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

    const cacheCheck = await pool.query(
      'SELECT * FROM availabilities WHERE movie_id = $1 AND last_checked > NOW() - INTERVAL \'7 days\'',
      [tmdb_id]
    );

    let availabilities;

    if (cacheCheck.rows.length > 0) {
      console.log('Using cached data');
      availabilities = cacheCheck.rows;
    } else {
      console.log('Fetching fresh data from uNoGS...');
      availabilities = await fetchAndCacheAvailability(tmdb_id, movieDetails);
    }

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
    
    // Search using the /search endpoint with query parameter
    const searchResponse = await unogsClient.get('/search', {
      params: {
        query: movieDetails.title,
        type: 'movie',
        limit: 10
      }
    });

    console.log('uNoGS search response:', searchResponse.data ? 'Success' : 'No data');

    const availabilities = [];

    if (searchResponse.data && searchResponse.data.results && searchResponse.data.results.length > 0) {
      // Find the best match
      let bestMatch = searchResponse.data.results[0];
      
      // Try to find exact title match
      const exactMatch = searchResponse.data.results.find(result => 
        result.title?.toLowerCase() === movieDetails.title.toLowerCase() ||
        result.title?.toLowerCase() === movieDetails.original_title?.toLowerCase()
      );
      
      if (exactMatch) {
        bestMatch = exactMatch;
      }

      const netflixId = bestMatch.nfid || bestMatch.id;
      console.log(`Found Netflix ID: ${netflixId} for title: ${bestMatch.title}`);

      // Get countries where this title is available
      if (bestMatch.clist) {
        const countries = bestMatch.clist.split(',');
        
        // Check audio/subtitle info from the search result
        const audioList = bestMatch.audio || [];
        const subtitleList = bestMatch.subtitle || [];
        
        const hasFrenchAudio = audioList.some(a => a.toLowerCase().includes('french') || a.toLowerCase().includes('français'));
        const hasFrenchSubs = subtitleList.some(s => s.toLowerCase().includes('french') || s.toLowerCase().includes('français'));

        console.log(`French audio: ${hasFrenchAudio}, French subs: ${hasFrenchSubs}`);
        console.log(`Available in ${countries.length} countries`);

        for (const countryCode of countries) {
          await pool.query(
            `INSERT INTO availabilities (movie_id, country_code, platform, has_french_audio, has_french_subtitles, netflix_id, last_checked)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (movie_id, country_code, platform) 
             DO UPDATE SET has_french_audio = $4, has_french_subtitles = $5, netflix_id = $6, last_checked = NOW()`,
            [tmdb_id, countryCode.trim(), 'netflix', hasFrenchAudio, hasFrenchSubs, netflixId]
          );

          availabilities.push({
            country_code: countryCode.trim(),
            has_french_audio: hasFrenchAudio,
            has_french_subtitles: hasFrenchSubs,
            netflix_id: netflixId,
            platform: 'netflix'
          });
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
      console.error('uNoGS error data:', error.response.data);
    }
    return [];
  }
}

function getCountryName(code) {
  const countries = {
    'FR': 'France', 'US': 'États-Unis', 'GB': 'Royaume-Uni', 'CA': 'Canada',
    'DE': 'Allemagne', 'ES': 'Espagne', 'IT': 'Italie', 'JP': 'Japon',
    'BR': 'Brésil', 'MX': 'Mexique', 'AU': 'Australie', 'NL': 'Pays-Bas',
    'BE': 'Belgique', 'CH': 'Suisse', 'SE': 'Suède', 'NO': 'Norvège',
    'DK': 'Danemark', 'FI': 'Finlande', 'PL': 'Pologne', 'PT': 'Portugal',
    'IN': 'Inde', 'KR': 'Corée du Sud', 'AR': 'Argentine', 'CL': 'Chili'
  };
  return countries[code] || code;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 VF Movie Finder API running on port ${PORT}`);
  console.log(`📍 Endpoints:`);
  console.log(`   - GET /api/search?query=inception`);
  console.log(`   - GET /api/movie/:tmdb_id/availability?audio_filter=vf`);
});

module.exports = app;
