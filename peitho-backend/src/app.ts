import express from 'express';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { calendarRouter } from './routes/calendar';
import { meetingsRouter } from './routes/meetings';
import { clientsRouter } from './routes/clients';
import { adminRouter } from './routes/admin';

export const app = express();

app.use(express.json());
app.use(healthRouter);
app.use(authRouter);
app.use(calendarRouter);
app.use(meetingsRouter);
app.use(clientsRouter);
app.use(adminRouter);
