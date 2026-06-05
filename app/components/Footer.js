import Link from "next/link";
import NewsletterForm from "./NewsletterForm";
import T from "./T";

const CONTACT_EMAIL = "hello@depot.paris";

export default function Footer() {
  return (
    <footer className="bg-[#0a0a0a] text-zinc-50 px-6 py-16 sm:px-10 sm:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="text-[clamp(28px,5vw,40px)] font-bold uppercase leading-none tracking-tight">
          DÉPÔT
        </p>
        <p className="mt-3 font-mono text-[11px] text-zinc-500">
          <T k="footer.tagline" />
        </p>

        <div id="newsletter" className="mt-12 max-w-sm scroll-mt-[80px]">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
            <T k="footer.newsletter" />
          </p>
          <div className="mt-3">
            <NewsletterForm />
          </div>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-8 max-w-sm">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
              <T k="footer.explore" />
            </p>
            <ul className="mt-3 space-y-2 font-mono text-[12px] text-zinc-100">
              <li><Link href="/feed" className="hover:text-white transition-colors"><T k="footer.feed" /></Link></li>
              <li><Link href="/stores" className="hover:text-white transition-colors"><T k="footer.stores" /></Link></li>
              <li><Link href="/saved" className="hover:text-white transition-colors"><T k="footer.saved" /></Link></li>
            </ul>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
              <T k="footer.connect" />
            </p>
            <ul className="mt-3 space-y-2 font-mono text-[12px] text-zinc-100">
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="hover:text-white transition-colors"
                >
                  <T k="footer.contact" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 border-t border-zinc-800 pt-6 flex justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          <span>© 2026 Dépôt</span>
          <span>Paris</span>
        </div>
      </div>
    </footer>
  );
}
