import { getAllEntries } from "../../content/editorial/index.js";

export const metadata = {
  title: "Editorial · Dépôt",
};

export default function EditorialIndexPage() {
  const entries = getAllEntries();
  return (
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900 px-8 py-12">
      <h1 className="font-mono text-[11px] uppercase tracking-[0.22em]">
        Editorial
      </h1>
      <ul className="mt-8 space-y-4">
        {entries.map((e) => (
          <li key={e.slug} className="font-sans text-[15px]">
            <a href={`/editorial/${e.slug}`} className="underline">
              {e.hero.title}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
