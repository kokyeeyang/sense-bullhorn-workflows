export function formatNumber(value: number | undefined | null) {
  return new Intl.NumberFormat("en-GB").format(Number(value || 0));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Never";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getDefaultDateRange(days = 7) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  return {
    dateFrom: toDateInput(start),
    dateTo: toDateInput(end),
  };
}

export function stringifyValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}
