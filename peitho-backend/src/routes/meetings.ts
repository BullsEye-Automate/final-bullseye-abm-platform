import { Router } from 'express';
import { pool } from '../db';

export const meetingsRouter = Router();

// La extensión de Chrome llama esto cada vez que navega a meet.google.com/{codigo}
// para saber si debe arrancar chrome.tabCapture.
meetingsRouter.get('/meetings/lookup', async (req, res) => {
  const meetCode = req.query.meet_code;
  if (typeof meetCode !== 'string' || meetCode.trim() === '') {
    res.status(400).json({ error: 'Falta el parámetro meet_code' });
    return;
  }

  try {
    const { rows } = await pool.query(
      `select id, auto_capture
       from meetings
       where meet_code = $1
       order by abs(extract(epoch from (start_time - now())))
       limit 1`,
      [meetCode]
    );

    const meeting = rows[0];
    if (!meeting) {
      res.json({ registered: false });
      return;
    }

    res.json({
      registered: true,
      meeting_id: meeting.id,
      auto_capture: meeting.auto_capture,
    });
  } catch (error) {
    console.error('Error en /meetings/lookup', error);
    res.status(500).json({ error: 'Error consultando la reunión' });
  }
});
