# 🛡️ Estrategia de Backup de Feedbacks

## Problema Original
Los feedbacks de reuniones se perdían periódicamente debido a:
1. Scripts manuales de dedup sin validación
2. Cascade delete en foreign keys
3. Sin auditoría de cambios
4. Sin snapshots periódicos

## Solución Implementada

### 1. **Snapshots Automáticos** (`feedback_backup_snapshots`)
Tabla que guarda un backup JSON completo de todos los feedbacks periódicamente.

**Crear snapshot manualmente:**
```bash
curl -X POST https://bullseye-abm-platform-eq6f.vercel.app/api/meetings/backup-snapshot \
  -H "Content-Type: application/json"
```

**Listar snapshots guardados:**
```bash
curl https://bullseye-abm-platform-eq6f.vercel.app/api/meetings/backup-snapshot
```

### 2. **Auditoría de Cambios** (`feedback_audit_log`)
Trigger automático que registra TODOS los cambios en `meeting_feedback`:
- INSERT: Cuando se agrega un nuevo feedback
- UPDATE: Cuando se modifica
- DELETE: Cuando se elimina (con snapshot del dato eliminado)

**Verificar auditoría de una reunión:**
```sql
select action, changed_at, old_data, new_data
from feedback_audit_log
where meeting_id = 'meeting-uuid-aqui'
order by changed_at desc;
```

### 3. **Export Manual** (`/api/meetings/export-backup`)
Descarga JSON completo de todos los feedbacks:
```bash
curl https://bullseye-abm-platform-eq6f.vercel.app/api/meetings/export-backup > feedbacks-backup.json
```

### 4. **Protecciones a Nivel API**
- `DELETE /api/clients/[id]`: Valida que no tenga feedbacks
- `DELETE /api/meetings/[id]`: Rechaza si tiene feedback_status='con_feedback'

### 5. **Protecciones a Nivel BD**
- Trigger `prevent_meeting_deletion_with_feedback()`: Bloquea DELETE de meetings con feedback
- Foreign keys con `ON DELETE RESTRICT` en lugar de `CASCADE`

## Proceso de Recuperación

Si necesitas recuperar feedbacks deletreados accidentalmente:

**Paso 1:** Revisar auditoría
```sql
-- Ver todos los DELETEs de feedback
select * from feedback_audit_log
where action = 'DELETE'
order by changed_at desc
limit 20;
```

**Paso 2:** Restaurar desde snapshot
```sql
-- Ver snapshots disponibles
select id, snapshot_date, total_feedbacks from feedback_backup_snapshots
order by snapshot_date desc
limit 10;

-- Extraer feedback de un snapshot específico
select jsonb_array_elements(backup_data -> 'feedbacks') as feedback
from feedback_backup_snapshots
where id = 'snapshot-uuid-aqui';
```

**Paso 3:** Re-insertar (si es necesario)
```sql
insert into meeting_feedback (meeting_id, calificacion, ...)
select ... from backup_data;
```

## Cron Job Recomendado

Crear un snapshot automático cada 6 horas:
```bash
# En Vercel, agregar a vercel.json:
{
  "crons": [{
    "path": "/api/meetings/backup-snapshot",
    "schedule": "0 */6 * * *"
  }]
}
```

Y enviar header de validación:
```
x-cron-secret: $CRON_SECRET
```

## Checklist de Implementación

- [ ] Ejecutar migrations SQL en Supabase:
  - `supabase/feedback_backup_audit_migration.sql`
- [ ] Crear primer snapshot manualmente
- [ ] Configurar cron job (opcional pero recomendado)
- [ ] Documentar proceso de recuperación para el equipo
- [ ] Probar que la auditoria se registra correctamente

## Monitoreo

**Dashboard de salud de backups:**
```sql
select 
  (select count(*) from meeting_feedback) as total_feedbacks,
  (select count(*) from feedback_backup_snapshots) as total_snapshots,
  (select max(snapshot_date) from feedback_backup_snapshots) as ultimo_backup,
  (select count(*) from feedback_audit_log where action = 'DELETE' and changed_at > now() - interval '7 days') as deletes_ultima_semana;
```

---

**⚠️ IMPORTANTE:** Nunca más correr scripts manuales de dedup sin:
1. Crear snapshot previo
2. Revisar auditoría después
3. Validar que los feedbacks fueron preservados
