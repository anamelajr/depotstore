import Link from "next/link";
import NewsletterForm from "./NewsletterForm";
import T from "./T";

const CONTACT_EMAIL = "hello@depot.paris";

export default function Footer() {
  return (
    <footer className="bg-white text-zinc-950 px-6 py-16 sm:px-10 sm:py-20">
      <div className="mx-auto max-w-4xl">
        <div id="newsletter" className="scroll-mt-[80px]">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
            <T k="footer.newsletter" />
          </p>
          <p className="mt-3 text-sm text-zinc-600">
            <T k="newsletter.label" />
          </p>
          <div className="mt-4 max-w-2xl">
            <NewsletterForm />
          </div>
        </div>

        <ul className="mt-12 flex flex-wrap gap-x-6 gap-y-3">
          <li>
            <Link
              href="/feed"
              className="font-mono text-[12px] uppercase tracking-widest text-zinc-800 hover:text-zinc-500 transition-colors"
            >
              <T k="footer.feed" />
            </Link>
          </li>
          <li>
            <Link
              href="/stores"
              className="font-mono text-[12px] uppercase tracking-widest text-zinc-800 hover:text-zinc-500 transition-colors"
            >
              <T k="footer.stores" />
            </Link>
          </li>
          <li>
            <Link
              href="/designers"
              className="font-mono text-[12px] uppercase tracking-widest text-zinc-800 hover:text-zinc-500 transition-colors"
            >
              <T k="footer.designers" />
            </Link>
          </li>
          <li>
            <Link
              href="/editorial"
              className="font-mono text-[12px] uppercase tracking-widest text-zinc-800 hover:text-zinc-500 transition-colors"
            >
              <T k="footer.editorial" />
            </Link>
          </li>
          <li>
            <Link
              href="/about"
              className="font-mono text-[12px] uppercase tracking-widest text-zinc-800 hover:text-zinc-500 transition-colors"
            >
              <T k="footer.about" />
            </Link>
          </li>
          <li>
            <Link
              href="/saved"
              className="font-mono text-[12px] uppercase tracking-widest text-zinc-800 hover:text-zinc-500 transition-colors"
            >
              <T k="footer.saved" />
            </Link>
          </li>
          <li>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-mono text-[12px] uppercase tracking-widest text-zinc-800 hover:text-zinc-500 transition-colors"
            >
              <T k="footer.contact" />
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
