// Minimal root-level fallback: any route without its own loading.js gets an
// empty full-height ground instead of a frozen previous page. Deliberately
// contentless — a spinner here would flash on fast navigations.
export default function RootLoading() {
  return <div className="min-h-screen bg-white" />;
}
