export const dynamic = "force-dynamic";

export const metadata = {
  title: "Saved — Dépôt",
};

export default function SavedPage() {
  return (
    <main className="flex min-h-[calc(100vh-var(--nav-height))] flex-col items-center justify-center px-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600 mb-4">
        Saved
      </p>
      <p className="font-mono text-[13px] uppercase tracking-widest text-zinc-300">
        Coming soon
      </p>
      <p className="mt-6 max-w-sm text-center text-sm leading-7 text-zinc-500">
        Save items you like and come back to them later. We&apos;re building this — drop your email below to hear when it lands.
      </p>
    </main>
  );
}
