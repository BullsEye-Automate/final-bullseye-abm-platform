import { Router } from 'express';

// Bug real (30-09-2026, cliente de Crossnet/ejohnson@crossnet.cl): el log de
// Supabase confirmó que /verify + Login se completaron bien (el link SÍ era
// válido), pero /invitacion igual le mostró "link inválido" — el error real
// (lo que devolvió setSession(), o si directamente no había tokens en el
// fragmento) solo se logueaba con console.error en el NAVEGADOR del cliente
// externo, invisible para nosotros — no hay forma de pedirle a un cliente no
// técnico que nos mande la consola del navegador. Esta ruta pública (sin
// requireAuth, a propósito — corre ANTES de que exista ninguna sesión) le da
// a /invitacion un lugar donde dejar esa evidencia en los logs de Railway.
// Nunca se guarda en la base (no hace falta persistirlo, solo verlo en el
// momento) ni se expone nada sensible — los tokens de la URL nunca se mandan
// acá, solo un resumen del motivo de la falla.
export const publicDiagnosticsRouter = Router();

publicDiagnosticsRouter.post('/public/invitacion-diagnostico', (req, res) => {
  const { reason, detail, userAgent, hadHash } = req.body ?? {};
  console.warn(
    `[invitacion-diagnostico] reason=${reason ?? '(sin dato)'} hadHash=${hadHash ?? '(sin dato)'} detail=${
      typeof detail === 'string' ? detail.slice(0, 500) : '(sin dato)'
    } userAgent=${typeof userAgent === 'string' ? userAgent.slice(0, 300) : '(sin dato)'}`
  );
  res.status(204).end();
});
