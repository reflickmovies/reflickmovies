import { Router } from 'express';
import * as api from '../controllers/api.controller.js';
import * as find from '../controllers/search.controller.js';
import { cacheControl } from '../middleware/cacheControl.js';
import { generalLimiter, searchLimiter, streamLimiter } from '../middleware/rateLimit.js';

/**
 * The complete public surface.
 *
 * `/api/home` is the one that matters: it returns everything the landing page
 * renders, in a single request, straight from MongoDB.
 *
 * Every first segment of this file's routes must be listed in `OWN_API_SEGMENTS`
 * (config/constants.ts): the embed mirror proxies any other `/api/<segment>` to the
 * player's origin and would otherwise answer for a route defined here.
 */
export const router: Router = Router();

router.get('/health', api.getHealth);

/* ------------------------------------------------------------------ home */

router.get('/home', generalLimiter, cacheControl(900), api.getHome);

router.get('/shelves/:key', generalLimiter, cacheControl(900), api.getShelf);

/* --------------------------------------------------------------- catalog */

router.get('/titles', generalLimiter, cacheControl(900), api.browse);

router.get('/genres', generalLimiter, cacheControl(86_400), api.getGenres);

router.get('/providers', generalLimiter, cacheControl(86_400), api.getProviders);

/* --------------------------------------------------------- notifications */

router.get('/notifications', generalLimiter, cacheControl(120), api.getNotifications);

/* ---------------------------------------------------------------- search */

router.get('/search', searchLimiter, cacheControl(300), find.searchTitles);

router.get('/search/suggest', searchLimiter, cacheControl(300), find.suggestTitles);

/* ---------------------------------------------------------------- detail */

router.get('/titles/:type/:slug', generalLimiter, cacheControl(900), api.getTitle);

router.get('/titles/:type/:slug/related', generalLimiter, cacheControl(1800), api.getRelated);

router.get('/titles/:type/:slug/seasons', generalLimiter, cacheControl(3600), api.getSeasons);

router.get('/titles/:type/:slug/seasons/:season/episodes', generalLimiter, cacheControl(3600), api.getEpisodes);

/* --------------------------------------------------------------- streams */

router.get('/titles/:type/:slug/servers', streamLimiter, find.getServers);

router.post('/titles/:type/:slug/servers/report', streamLimiter, find.reportServer);

router.post('/titles/:type/:slug/servers/reset', streamLimiter, find.clearReports);