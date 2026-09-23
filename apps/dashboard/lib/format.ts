const BRUSSELS = "Europe/Brussels";

// nl-BE, Europe/Brussels: zowel voor herinneringen (tijdstip) als geboorte-/verwijderdatum.
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("nl-BE", { timeZone: BRUSSELS, dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("nl-BE", { timeZone: BRUSSELS, dateStyle: "long" }).format(date);
}
