import express from 'express';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { calendarRouter } from './routes/calendar';
import { meetingsRouter } from './routes/meetings';
import { clientsRouter } from './routes/clients';
import { adminRouter } from './routes/admin';
import { webhooksRouter } from './routes/webhooks';

export const app = express();

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
