import express from 'express';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { calendarRouter } from './routes/calendar';
import { meetingsRouter } from './routes/meetings';
import { clientsRouter } from './routes/clients';
import { adminRouter } from './routes/admin';
import { webhooksRouter } from './routes/webhooks';
import { panelRouter } from './routes/panel';
import { publicResearchRouter } from './routes/publicResearch';

export const app = express();

// CORS — hasta ahora todo el tráfico del navegador pasaba por rutas proxy de
// Next.js (server-side, sin CORS), pero eso choca con el límite de payload
// de las funciones serverless de Vercel (4.5MB en el plan Hobby, no
// configurable): un PDF real de una presentación comercial de 4.7MB nunca
// llegaba a este backend, cortado por Vercel antes. Fix: subir el archivo
// directo del navegador a este backend (que sí acepta hasta 50MB, ver
// routes/clients.ts), lo que exige habilitar CORS para el origen del
// frontend. Allowlist explícita (nunca "*") porque estas rutas validan la
// sesión de Supabase por Bearer token, no por cookie — CORS acá es defensa
// en profundidad, no el mecanismo de auth.
const DEFAULT_FRONTEND_ORIGINS = ['http://localhost:3002', 'https://peitho-rho.vercel.app'];
const FRONTEND_ORIGINS = process.env.PEITHO_FRONTEND_ORIGINS
  ? process.env.PEITHO_FRONTEND_ORIGINS.split(',').map((origin) => origin.trim())
  : DEFAULT_FRONTEND_ORIGINS;

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && FRONTEND_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// El "verify" guarda el body crudo en req.rawBody — lo necesita el webhook de
// Recall (routes/webhooks.ts) para verificar la firma Svix, que se calcula
// sobre los bytes exactos recibidos, no sobre el JSON ya parseado/re-serializado.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(healthRouter);
app.use(authRouter);
app.use(calendarRouter);
app.use(meetingsRouter);
app.use(clientsRouter);
app.use(adminRouter);
app.use(webhooksRouter);
app.use(panelRouter);
app.use(publicResearchRouter);
