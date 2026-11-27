// Campos de contacto con teléfono, correo y LinkedIn en el HubSpot de BullsEye.
// Con los años se fueron creando varios campos para lo mismo (revisados contra
// todas las propiedades de contacto el 27-nov-2026): los que leen la Base de
// contactos, Calidad de carga, Pulso ABM y «Llamar con Allo» salen de aquí.
// Orden = de más a menos confiable (el primero manda cuando hay que elegir uno).
export const CONTACT_PHONE_FIELDS = [
  "mobilephone", "phone", "telefono_lemlist", "bullseye_telefono_lusha", "bullseye_telefono_clay",
  "hs_whatsapp_phone_number", "phone_4", "numero_de_telefono_2", "phone_3", "phone_5",
  "telefono_lusha", "telefono_lusha_2", "bullseye_telefono_lemlist",
];
export const CONTACT_EMAIL_FIELDS = ["email", "correo_secundario", "hs_additional_emails"];
export const CONTACT_LINKEDIN_FIELDS = ["hs_linkedin_url", "url_linkedin_bullseye", "linkedin_url_sales_nav"];
// Campos con teléfono revelado por Lemlist (el de «por borrar» es el antiguo)
export const LEMLIST_PHONE_FIELDS = ["telefono_lemlist", "bullseye_telefono_lemlist"];

// Para los HubSpot propios de los clientes, que tienen sus propios nombres:
// además de los conocidos, se toman los campos de texto cuya etiqueta dice
// teléfono / correo / LinkedIn y no son marcas, fechas ni configuraciones.
type Prop = { name: string; label: string; type: string; fieldType?: string };
const PHONE_LABEL = /tel[eé]fono|phone|celular|m[oó]vil|mobile|whats ?app|\bfono\b/i;
const EMAIL_LABEL = /correo|e-?mail/i;
const LINKEDIN_LABEL = /linked ?in/i;
const NOT_DATA = /proveedor|provider|fuente|source|buscador|central|v[aá]lid|subscri|suscrip|opt|consent|bsuid|tipo|type|count|fecha|date|body|subject|asunto|domain|dominio|bounce|rebote|quarant|enviad|sent|estado|status|bio|connection|headline|icebreaker|click|invitaci|mensaje|score|resultado/i;

export function detectContactFields(props: Prop[]) {
  const have = new Set(props.map((p) => p.name));
  const extra = (re: RegExp, known: string[]) => props
    .filter((p) => !known.includes(p.name) && !p.name.startsWith("hs_") && (p.type === "string" || p.fieldType === "phonenumber")
      && re.test(p.label) && !NOT_DATA.test(`${p.label} ${p.name}`))
    .map((p) => p.name);
  return {
    phones: [...CONTACT_PHONE_FIELDS.filter((n) => have.has(n)), ...extra(PHONE_LABEL, CONTACT_PHONE_FIELDS)],
    emails: [...CONTACT_EMAIL_FIELDS.filter((n) => have.has(n)), ...extra(EMAIL_LABEL, CONTACT_EMAIL_FIELDS)],
    linkedins: [...CONTACT_LINKEDIN_FIELDS.filter((n) => have.has(n)), ...extra(LINKEDIN_LABEL, CONTACT_LINKEDIN_FIELDS)],
  };
}
