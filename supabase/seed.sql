-- ICP inicial v1 — configurar en /configuracion/icp según el cliente
insert into icp_config (
  version, is_active, org_types,
  signals_strong, signals_medium, signals_weak,
  size_rules, pipeline_mix, competitors, geographies, notes, created_by
) values (
  1, true,
  '[
    {"key":"lab","label":"Laboratorio dental","accept":true},
    {"key":"multi_clinic","label":"Clínica dental multi-centro","accept":true,"note":"Evaluar centros × tamaño"},
    {"key":"dso","label":"DSO","accept":true,"note":"Prioridad alta"},
    {"key":"single_clinic","label":"Clínica 1 centro pequeño","accept":false},
    {"key":"distributor","label":"Distribuidor / proveedor","accept":false},
    {"key":"software_vendor","label":"Proveedor de software","accept":false},
    {"key":"academia","label":"Academia / universidad","accept":false}
  ]'::jsonb,
  '[
    "Mencionan exocad, inLab, 3Shape o Dental Wings en web/LinkedIn",
    "Publican casos de coronas CAD, zirconia milled, puentes digitales, implantes digitales",
    "Tienen equipo de milling o impresión 3D listado o visible",
    "Empleado con título CAD/CAM Technician, CAD Designer en LinkedIn"
  ]'::jsonb,
  '[
    "Mencionan digital workflow, same-day crowns o digital impressions sin software específico",
    "Comparten contenido de escáneres intraorales (iTero, Medit, Carestream, Cerec)",
    "Web o redes muestran restauraciones claramente CAD"
  ]'::jsonb,
  '[
    "Mencionan escáner de modelos de yeso (no intraoral)",
    "Usan la palabra digital sin tecnología concreta",
    "Contenido visible 100% analógico"
  ]'::jsonb,
  '[
    {"min":1,"max":2,"decision":"reject","note":"Sin volumen suficiente"},
    {"min":3,"max":14,"decision":"approve","note":"Volumen medio — anotar"},
    {"min":15,"max":50,"decision":"approve","note":"Sweet spot"},
    {"min":51,"max":null,"decision":"approve","note":"Overflow — prioridad"}
  ]'::jsonb,
  '[
    {"label":"5–30 con flujo digital","share":60,"velocity":"rápido"},
    {"label":"31–100","share":25,"velocity":"medio"},
    {"label":"100+","share":15,"velocity":"lento"}
  ]'::jsonb,
  '[
    {"name":"Evident","note":""},
    {"name":"Full Contour","note":""},
    {"name":"Aidite","note":""},
    {"name":"Automate (by 3Shape)","note":"Integrado en ecosistema 3Shape"}
  ]'::jsonb,
  '[
    {"region":"US","priority":"principal"},
    {"region":"CA","priority":"secundario"},
    {"region":"EU","priority":"terciario","note":"GDPR — legitimate interest"},
    {"region":"LATAM","priority":"oportunístico"}
  ]'::jsonb,
  'Regla de oro: lab / multi-centro / DSO + flujo digital + volumen real. Tener diseñadores propios NO descarta — es señal de que entienden el valor.',
  'system'
);
