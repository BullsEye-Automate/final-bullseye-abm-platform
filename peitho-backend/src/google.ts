import { google } from 'googleapis';
import { pool } from './db';

// calendar.readonly alcanza para events.watch/events.list. events.patch (Tarea 8)
// va a requerir re-autorizar con el scope de escritura ('calendar.events').
// spreadsheets.readonly se agregó para leer el excel de metas (nombre/cargo/
// industria/cliente de cada reunión) — cualquier cuenta ya conectada necesita
// pasar de nuevo por /auth/google para que el nuevo scope quede autorizado.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Se valida acá (no a nivel de módulo) para que el resto del backend (ej. /health)
// siga funcionando aunque todavía no se hayan configurado las credenciales de Google.
export function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Faltan variables de entorno de Google OAuth (ver .env.example)');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl() {
  return createOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
  });
}

export async function saveCredentialFromCode(code: string): Promise<string> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  if (!tokens.refresh_token) {
    throw new Error(
      'Google no devolvió refresh_token. Ve a https://myaccount.google.com/permissions, revoca el acceso previo a esta app y vuelve a intentar /auth/google.'
    );
  }

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data: userInfo } = await oauth2.userinfo.get();
  const email = userInfo.email;
  if (!email) {
    throw new Error('No se pudo obtener el email de la cuenta de Google autorizada');
  }

  await pool.query(
    `insert into google_credentials (google_account_email, access_token, refresh_token, token_expiry)
     values ($1, $2, $3, $4)
     on conflict (google_account_email) do update set
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       token_expiry = excluded.token_expiry,
       updated_at = now()`,
    [
      email,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    ]
  );

  return email;
}

interface StoredCredentialRow {
  id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string | null;
}

async function getOAuthClientForEmail(email: string) {
  const { rows } = await pool.query<StoredCredentialRow>(
    'select id, access_token, refresh_token, token_expiry from google_credentials where google_account_email = $1',
    [email]
  );
  const credential = rows[0];
  if (!credential) {
    throw new Error(`No hay credenciales de Google guardadas para ${email}. Corre /auth/google primero.`);
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token: credential.access_token,
    refresh_token: credential.refresh_token,
    expiry_date: credential.token_expiry ? new Date(credential.token_expiry).getTime() : undefined,
  });

  // googleapis refresca el access_token solo cuando expira; persistimos el nuevo
  // access_token para no perderlo al reiniciar el proceso.
  client.on('tokens', (tokens) => {
    if (!tokens.access_token) return;
    pool
      .query('update google_credentials set access_token = $1, token_expiry = $2, updated_at = now() where id = $3', [
        tokens.access_token,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        credential.id,
      ])
      .catch((error) => console.error('No se pudo persistir el access_token renovado', error));
  });

  return { client, credentialId: credential.id as string };
}

export async function getCalendarClientByEmail(email: string) {
  const { client, credentialId } = await getOAuthClientForEmail(email);
  return { calendar: google.calendar({ version: 'v3', auth: client }), credentialId };
}

// Usado por metasSheet.ts para leer el excel de metas — requiere que la
// cuenta pasada haya autorizado el scope spreadsheets.readonly (ver
// GOOGLE_SCOPES arriba) y que ese excel esté compartido con esa cuenta.
export async function getSheetsClientByEmail(email: string) {
  const { client, credentialId } = await getOAuthClientForEmail(email);
  return { sheets: google.sheets({ version: 'v4', auth: client }), credentialId };
}
