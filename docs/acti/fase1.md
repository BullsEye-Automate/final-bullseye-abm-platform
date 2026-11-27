# ACTI · Fase 1 — cómo probarla

**Incluye:** marca "Socio ACTI" y plan en el cliente, configuración editable de planes, tema ACTI, navegación del socio y la pantalla de Inicio.

## Antes de probar

1. Correr en Supabase `supabase/20261127_acti_fase1_migration.sql` (solo tablas nuevas: `acti_members`, `acti_members_log`, `acti_config`, `acti_config_log`). Sin la migración el portal sigue igual; las pantallas ACTI avisan que falta.
2. (Opcional) `supabase/acti_demo_seed.sql` crea 3 clientes demo ACTI.

## Equipo BullsEye

1. **Crear cliente** (`/clientes/nuevo`): al final está la casilla **Socio ACTI**; al marcarla se elige plan, estado, fecha de alta, KAM y fechas de la prueba Freemium.
2. **Configuración → Cliente → Socio ACTI**: marcar / desmarcar y cambiar plan de un cliente existente. Desmarcar devuelve al cliente al portal de siempre.
3. **Clientes** (`/clientes`): etiqueta "ACTI · <plan>" y filtro "Solo socios ACTI" (aparece solo si hay socios).
4. **Menú → ACTI → Red de Negocios** (`/acti-equipo`): socios por plan y **Planes y parámetros**. Solo amadriz@, ihincapie@ y jkarmy@ pueden guardar; el resto lo ve en solo lectura. Cambiar las reuniones garantizadas o la conversión cambia al instante el cupo de empresas de los socios.

## Socio ACTI

1. Crear un usuario del portal para un cliente ACTI (Configuración → Cliente → Portal del cliente — accesos) y entrar con él.
2. Llega a **/acti**: menú "ACTI · Red de Negocios", "Operado por BullsEye" con el logo de BullsEye, espacio para el logo de ACTI y tema ACTI (Montserrat, claro / oscuro según el sistema).
3. **Inicio:**
   - Plan pagado: reuniones realizadas del mes contra la garantía, agendadas por realizar, empresas pedidas contra el cupo (reuniones ÷ 10%) y no-shows (sin cobro).
   - Freemium: reuniones (x / 2), empresas (x / 20), días restantes de los 90 y, al completar un tope, aviso de prueba completada con invitación a cambiar de plan.
   - Próximas reuniones (con nombre, cargo, correo y teléfono del contacto, porque ya están agendadas), feedback pendiente, próximo evento y novedades.
4. El resto de los módulos aparecen en el menú con "Pronto" y se construyen en las fases 2 a 5. Las vistas de Pulso ABM del menú dependen del plan (Freemium ninguna, Conecta 2, Crece 6 con Peitho, Acelera todas).
5. Si el socio intenta abrir `/portal` lo lleva a `/acti`; las APIs del portal normal le responden 403.

## No regresión

- `npm test`: 24 pruebas (planes y límites, permisos, rutas y **middleware**: usuario interno, cliente normal del portal y anónimo se comportan igual que antes).
- `npx tsc --noEmit`: sin errores nuevos (los 28 que hay ya existían).
- `next build`: OK.
- Manual, con un cliente que **no** es ACTI: crear cliente (sin marcar la casilla), ver ficha y Configuración → Cliente, Sistema → ICP, recomendaciones en Empresas, Reuniones y Peitho; y entrar al portal con un usuario de ese cliente: debe ver exactamente lo mismo que antes.

## Archivos compartidos que se tocaron (aprobados)

`middleware.ts` (rama nueva para usuarios con la marca ACTI), `app/portal/layout.tsx` (redirige a /acti si el cliente es socio), `components/AppShell.tsx` y `components/Providers.tsx` (/acti con layout propio, sin la lista interna de clientes), `components/Sidebar.tsx` (grupo ACTI), `app/clientes/page.tsx`, `app/clientes/nuevo/page.tsx` y `app/configuracion/cliente/page.tsx` (sección y etiqueta ACTI). `package.json`: `vitest` (desarrollo) y script `test`.
