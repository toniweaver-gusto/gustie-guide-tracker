export function formatMT(dateInput: string | Date): string {
  let date: Date;
  if (typeof dateInput === "string") {
    const str =
      dateInput.endsWith("Z") || dateInput.includes("+")
        ? dateInput
        : dateInput + "Z";
    date = new Date(str);
  } else {
    date = dateInput;
  }

  return date.toLocaleString("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}
