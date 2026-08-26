// The stores page is white-ground, so a plain white shell is the right
// stand-in — deliberately contentless, matching app/loading.js's reasoning: a
// skeleton list would flash on the fast navigations this page usually gets.
export default function StoresLoading() {
  return <div className="min-h-screen" />;
}
