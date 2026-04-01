export function formatDate(d: string | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mi = Number(m);
  const di = Number(day);
  if (!y || !Number.isFinite(mi) || !Number.isFinite(di)) return "—";
  return `${months[mi - 1]} ${di}, ${y}`;
}
