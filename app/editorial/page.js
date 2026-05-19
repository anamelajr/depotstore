import { getAllEntries } from "../../content/editorial/index.js";
import EditorialIndexCard from "./_components/EditorialIndexCard.js";

export const metadata = {
  title: "Editorial · Dépôt",
  description: "Editorial perspectives on archive fashion.",
};

export default function EditorialIndexPage() {
  const entries = getAllEntries();

  return (
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900">
      <section className="px-6 md:px-10 pt-14 md:pt-20 pb-16 md:pb-24">
        <header className="mb-12 md:mb-16">
          <h1 className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-950">
            Editorial
          </h1>
          <p className="mt-3 max-w-xl font-sans text-[15px] leading-relaxed text-zinc-700">
            Short, opinionated pieces on the designers and houses that shape archive fashion.
          </p>
        </header>
        {entries.length === 0 ? (
          <p className="font-mono text-[11px] text-zinc-600">No entries yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 md:gap-12">
            {entries.map((entry) => (
              <EditorialIndexCard key={entry.slug} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
