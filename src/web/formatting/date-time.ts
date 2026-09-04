export function formatDatasetTime(value: string | null | undefined): {
  readonly visible: string;
  readonly utc: string;
} {
  if (!value) return { visible: 'Dataset time unavailable', utc: 'No UTC timestamp available' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { visible: 'Dataset time unavailable', utc: 'Invalid UTC timestamp' };
  }
  const visible = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(date);
  return {
    visible: `Evaluated ${visible} IST`,
    utc: `${date.toISOString().replace('T', ' ').replace('.000Z', ' UTC')} · dataset evaluation time`,
  };
}

export function shortenHash(value: string | null | undefined): string {
  if (!value) return 'Manifest unavailable';
  const digest = value.startsWith('sha256:') ? value.slice(7) : value;
  return `Manifest ${digest.slice(0, 4)}…${digest.slice(-4)}`;
}
