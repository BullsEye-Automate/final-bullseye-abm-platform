import express from 'express';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { calendarRouter } from './routes/calendar';

export const app = express();

app.use(express.json());
app.use(healthRouter);
app.use(authRouter);
app.use(calendarRouter);
