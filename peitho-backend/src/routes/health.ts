import { Router } from 'express';
import { pool } from '../db';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  try {
    await pool.query('select 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Health check: fallo la conexión a la base de datos', error);
    res.status(503).json({ status: 'error', db: 'disconnected', timestamp: new Date().toISOString() });
  }
});
