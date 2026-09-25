// Browser-/node-veilig: geen imports, zodat het dashboard formatAge kan gebruiken
// zonder de AI SDK mee te slepen.
export function formatAge(ms: number): string {
  const totalHours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0) {
    return `${hours} uur`;
  }
  return `${days} ${days === 1 ? "dag" : "dagen"} en ${hours} uur`;
}

/** Leeftijd bij overlijden voor de Galerij (grafvierkant): deleted_at − born_at, in dagen of jaren (ADR-0002). */
export function ageLabel(bornAt: string | Date, deletedAt: string | Date): string {
  const days = Math.floor((new Date(deletedAt).getTime() - new Date(bornAt).getTime()) / 86_400_000);
  if (days < 1) return "minder dan een dag oud";
  if (days < 365) return `${days} ${days === 1 ? "dag" : "dagen"} oud`;
  return `${Math.floor(days / 365)} jaar oud`;
}
