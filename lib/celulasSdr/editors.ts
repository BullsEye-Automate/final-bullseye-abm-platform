// Quién puede cambiar el estado ("Realizado") de una reunión desde el
// Registro de reuniones de Células SDR — se escribe en la planilla API
// Reuniones. Confirmado con BullsEye: las líderes de célula e Ingri.
// Para sumar a alguien, agregar su correo aquí.
export const MEETING_EDITOR_EMAILS = [
  "nnazar@bullseye-abm.com",   // Nicolle Nazar (líder de célula)
  "vabarzua@bullseye-abm.com", // Vanessa Abarzúa (líder de célula)
  "ihincapie@bullseye-abm.com",
];

export function canEditMeetings(email: string | null | undefined): boolean {
  return !!email && MEETING_EDITOR_EMAILS.includes(email.trim().toLowerCase());
}
