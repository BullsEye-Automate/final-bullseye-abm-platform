// Cliente de Supabase con la service_role key — acceso total, nunca se usa en
// el frontend. Se usa tanto para Supabase Storage (base de conocimiento,
// Fase C) como para verificar sesiones y administrar usuarios (Fase E).
// Extraído de knowledgeBase.ts para no duplicar el fix de WebSocket.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Validado dentro de la función (no a nivel de módulo) para no romper el
// resto del backend si todavía no se configuró — mismo patrón que
// createOAuthClient() en google.ts.
export function getSupabaseAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno (ver .env.example)'
    );
  }
  // El cliente de Supabase inicializa su módulo de Realtime al crearse (aunque
  // acá no siempre se use), y desde una versión reciente exige WebSocket
  // nativo — solo disponible desde Node 22+. Se le pasa la implementación de
  // la librería `ws` explícitamente para que funcione igual en Node 20 (error
  // real visto: "Node.js detected but native WebSocket not found").
  return createClient(url, serviceRoleKey, { realtime: { transport: WebSocket as any } });
}
