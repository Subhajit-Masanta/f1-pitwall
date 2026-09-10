import axios from 'axios';

/**
 * Base URL for the API.
 *
 * Set VITE_API_BASE at build time for production (Cloudflare Pages / Vercel
 * env var). Falls back to the local backend so `npm run dev` just works.
 */
const baseURL = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

if (import.meta.env.DEV) console.log('[api] base:', baseURL);

const api = axios.create({
    baseURL,
    timeout: 120000,   // a cold, uncached session can legitimately take ~60s
    headers: { 'Content-Type': 'application/json' },
});

export default api;
