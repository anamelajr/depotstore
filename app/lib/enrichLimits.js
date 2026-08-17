// Retry ceiling for the enrich queue, lifted out of app/api/enrich/route.js so
// the formatting validator can import the SAME number rather than keep a second
// copy. The value is the line between "still queued, stay silent" and
// "enrichment gave up, report it" (app/lib/formattingHealth.js); two drifting
// copies would move that line without anyone noticing.
export const MAX_ENRICH_ATTEMPTS = 3;
