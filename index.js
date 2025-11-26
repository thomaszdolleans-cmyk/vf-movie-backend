const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ VÉRIFICATION DES VARIABLES D'ENVIRONNEMENT AU DÉMARRAGE
console.log('🔍 Vérification des variables d\'environnement...');
const requiredEnvVars = ['TMDB_API_KEY', 'UNOGS_API_KEY', 'DATABASE_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Variables d\'environnement manquantes:', missingVars);
  console.error('💡 Vérifiez votre configuration sur Render.com');
  process.exit(1);
}

console.log('✅ TMDB_API_KEY:', process.env.TMDB_API_KEY ? `${process.env.TMDB_API_KEY.substring(0, 8)}...` : '✗ MANQUANTE');
console.log('✅ UNOGS_API_KEY:', process.env.UNOGS_API_KEY ? `${process.env.UNOGS_API_KEY.substring(0, 8)}...` : '✗ MANQUANTE');
console.log('✅ DATABASE_URL:', process.env.DATABASE_URL ? 'Configurée ✓' : '✗ MANQUANTE');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test de connexion à la base de données
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erreur de connexion à la base de données:', err.message);
  } else {
    console.log('✅ Connexion à la base de données réussie');
    release();
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const tmdbClient = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  params: { api_key: process.env.TMDB_API_KEY }
});

const unogsClient = axios.create({
  baseURL: 'https://unogs-unogs-v1.p.rapidapi.com',
  headers: {
    'X-RapidAPI-Key': process.env.UNOGS_API_KEY,
    'X-RapidAPI-Host': 'unogs-unogs-v1.p.rapidapi.com'
  }
});

// 🆕 ROUTE DE DEBUG
app.get('/api/debug', (req, res) => {
  res.json({
    status: 'API Active',
    environment: {
      NODE_ENV: process.env.NODE_ENV || 'development',
      TMDB_API_KEY: process.env.TMDB_API_KEY ? '✓ Configurée' : '✗ Manquante',
      UNOGS_API_KEY: process.env.UNOGS_API_KEY ? '✓ Configurée' : '✗ Manquante',
      DATABASE_URL: process.env.DATABASE_URL ? '✓ Configurée' : '✗ Manquante'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/search', async (req, res) => {
  try {
    const searchQuery = req.query.query;
    
    if (!searchQuery || searchQuery.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    console.log(`🔍 Recherche pour: "${searchQuery}"`);

    const tmdbResponse = await tmdbClient.get('/search/movie', {
      params: { query: searchQuery, language: 'fr-FR' }
    });

    console.log(`✅ TMDB a trouvé ${tmdbResponse.data.results.length} résultats`);

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
    console.error('❌ Search error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    res.status(500).json({ 
      error: 'Search failed', 
      details: error.message,
      hint: error.response?.status === 401 ? 'Vérifiez votre TMDB_API_KEY' : null
    });
  }
});

app.get('/api/movie/:tmdb_id/availability', async (req, res) => {
  try {
    const { tmdb_id } = req.params;
    const { audio_filter } = req.query;

    console.log(`🎬 Recherche de disponibilité pour le film TMDB ID: ${tmdb_id}`);

    const movieDetails = await getOrCreateMovie(tmdb_id);

    const cacheCheck = await pool.query(
      'SELECT * FROM availabilities WHERE movie_id = $1 AND last_checked > NOW() - INTERVAL \'7 days\'',
      [tmdb_id]
    );

    let availabilities;

    if (cacheCheck.rows.length > 0) {
      console.log(`✅ Utilisation du cache (${cacheCheck.rows.length} entrées)`);
      availabilities = cacheCheck.rows;
    } else {
      console.log(`🔄 Récupération des données depuis uNoGS...`);
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
    console.error('❌ Availability error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    res.status(500).json({ 
      error: 'Failed to get availability', 
      details: error.message,
      hint: error.response?.status === 401 ? 'Vérifiez vos clés API' : null
    });
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
    const searchResponse = await unogsClient.get('/search/titles', {
      params: {
        title: movieDetails.title,
        type: 'movie'
      }
    });

    const availabilities = [];

    if (searchResponse.data.results && searchResponse.data.results.length > 0) {
      const netflixId = searchResponse.data.results[0].netflix_id;

      const detailsResponse = await unogsClient.get(`/title/details`, {
        params: { netflix_id: netflixId }
      });

      const details = detailsResponse.data;

      if (details.country_list) {
        for (const country of details.country_list) {
          const hasFrenchAudio = details.audio?.includes('French') || false;
          const hasFrenchSubs = details.subtitle?.includes('French') || false;

          await pool.query(
            `INSERT INTO availabilities (movie_id, country_code, platform, has_french_audio, has_french_subtitles, netflix_id, last_checked)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (movie_id, country_code, platform) 
             DO UPDATE SET has_french_audio = $4, has_french_subtitles = $5, netflix_id = $6, last_checked = NOW()`,
            [tmdb_id, country.country_code, 'netflix', hasFrenchAudio, hasFrenchSubs, netflixId]
          );

          availabilities.push({
            country_code: country.country_code,
            has_french_audio: hasFrenchAudio,
            has_french_subtitles: hasFrenchSubs,
            netflix_id: netflixId,
            platform: 'netflix'
          });
        }
      }
    }

    return availabilities;
  } catch (error) {
    console.error('❌ uNoGS fetch error:', error.message);
    if (error.response) {
      console.error('uNoGS Response status:', error.response.status);
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
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: {
      TMDB_API_KEY: process.env.TMDB_API_KEY ? '✓' : '✗',
      UNOGS_API_KEY: process.env.UNOGS_API_KEY ? '✓' : '✗',
      DATABASE_URL: process.env.DATABASE_URL ? '✓' : '✗'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 VF Movie Finder API running on port ${PORT}`);
  console.log(`📍 Endpoints:`);
  console.log(`   - GET /health`);
  console.log(`   - GET /api/debug`);
  console.log(`   - GET /api/search?query=inception`);
  console.log(`   - GET /api/movie/:tmdb_id/availability?audio_filter=vf`);
});

module.exports = app;
