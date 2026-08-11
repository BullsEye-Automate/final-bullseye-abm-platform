import { Router } from 'express';
import { getAuthUrl, saveCredentialFromCode } from '../google';

export const authRouter = Router();

authRouter.get('/auth/google', (_req, res) => {
  res.redirect(getAuthUrl());
});

authRouter.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (typeof code !== 'string') {
    res.status(400).send('Falta el parámetro code en la URL de callback');
    return;
  }

  try {
    const email = await saveCredentialFromCode(code);
    res.send(
      `Cuenta de Google conectada: ${email}. Ahora registra el watch del calendario con POST /calendar/watch y body {"google_account_email": "${email}"}.`
    );
  } catch (error) {
    console.error('Error en el callback de OAuth de Google', error);
    res.status(500).send('Error conectando la cuenta de Google. Revisa los logs del servidor.');
  }
});
