export interface IngestJobData {
  source: string;
}

export interface NotifyJobData {
  offer: {
    id: string;
    title: string;
    stack: string[];
  };
}

/**
 * Claves de idempotencia usadas como `jobId` estables de BullMQ. BullMQ
 * PROHÍBE `:` en jobIds custom ("Custom Id cannot contain :"), así que el
 * separador es `_`, no `:`.
 */
export function ingestJobId(source: string): string {
  return `ingest_${source}`;
}

export function notifyJobId(offerId: string): string {
  return `notify_${offerId}`;
}
