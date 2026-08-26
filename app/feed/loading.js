// Card-grid skeleton for navigations into /feed. The page's own Suspense
// boundary only covers the data load once the route is running; this covers
// the gap between the click and that render starting. Grid classes mirror
// FeedClient's `grid grid-cols-2 gap-10 lg:grid-cols-3 lg:gap-x-3.5 lg:gap-y-16`.
export default function FeedLoading() {
  return (
    <div className="min-h-screen font-mono text-zinc-950">
      <main className="px-4 pb-24 pt-3 md:px-6 md:pb-32 md:pt-8">
        <div className="grid grid-cols-2 gap-10 lg:grid-cols-3 lg:gap-x-3.5 lg:gap-y-16">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="animate-pulse">
              <div className="bg-zinc-100" style={{ aspectRatio: "4 / 5" }} />
              <div className="mt-3 h-[11px] w-1/2 rounded-[2px] bg-zinc-100" />
              <div className="mt-2 h-[11px] w-3/4 rounded-[2px] bg-zinc-100" />
              <div className="mt-2 h-[11px] w-1/4 rounded-[2px] bg-zinc-100" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
