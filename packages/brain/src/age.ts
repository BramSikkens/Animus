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
