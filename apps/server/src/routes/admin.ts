import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { requireAdmin } from '../middleware/auth.js';
import { noStore } from '../middleware/cors.js';

/**
 * The privileged surface. Every route here requires a valid admin token.
 *
 * Mounted under `/api/admin` and registered in `OWN_API_SEGMENTS` so the embed
 * mirror does not proxy these paths upstream.
 */
export const adminRouter: Router = Router();

adminRouter.use(requireAdmin);

adminRouter.get('/stats', noStore, admin.getStats);

adminRouter.get('/users', noStore, admin.getUsers);
adminRouter.get('/users/:id', noStore, admin.getUser);
adminRouter.patch('/users/:id/role', noStore, admin.updateUserRole);
adminRouter.delete('/users/:id', noStore, admin.deleteUser);

adminRouter.get('/visits', noStore, admin.getVisits);
adminRouter.get('/visits/stats', noStore, admin.getVisitStats);

adminRouter.get('/titles', noStore, admin.getTitles);
adminRouter.delete('/titles/:id', noStore, admin.deleteTitle);

adminRouter.get('/providers', noStore, admin.getProviders);
adminRouter.patch('/providers/:id', noStore, admin.updateProvider);
adminRouter.get('/provider-default', noStore, admin.getProviderDefault);
adminRouter.patch('/provider-default', noStore, admin.setProviderDefault);

adminRouter.get('/cache', noStore, admin.getCache);
adminRouter.post('/cache/clear', noStore, admin.clearCache);
