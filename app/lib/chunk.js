// Split an array into sub-arrays of at most `size` elements. Used to keep
// Supabase `.in("col", arr)` URL lengths under PostgREST's ~16 KB cap when
// `arr` contains many long strings (e.g. handles up to 126 chars on lobscur).
export function chunkArray(arr, size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(
      `chunkArray: size must be a positive integer, got ${String(size)}`
    );
  }
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
