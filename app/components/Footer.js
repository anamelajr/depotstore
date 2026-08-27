import Link from "next/link";
import NewsletterForm from "./NewsletterForm";
import FooterRegionMenu from "./FooterRegionMenu";
import T from "./T";

const CONTACT_EMAIL = "hello@depot.paris";

const columnHeading =
  "m-0 mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-white";
const linkColumn =
  "flex flex-col gap-[11px] font-mono text-[9px] uppercase tracking-[0.12em]";
const link = "text-white";

const BROWSE_LINKS = [
  { href: "/feed", k: "footer.feed" },
  { href: "/designers", k: "footer.designers" },
  { href: "/stores", k: "footer.stores" },
  { href: "/editorial", k: "footer.editorial" },
];

export default function Footer() {
  return (
    <footer className="bg-[#121212] text-white px-6 pt-14 pb-7 sm:px-12 sm:pt-[72px] sm:pb-8">
      <div className="mx-auto max-w-[1200px]">
        <div className="grid grid-cols-1 gap-y-14 sm:grid-cols-2 sm:gap-[96px] sm:items-start">
          <div id="newsletter" className="scroll-mt-[80px] sm:max-w-[400px]">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.22em] text-white">
              <T k="footer.newsletter" />
            </p>
            <div className="mt-[22px]">
              <NewsletterForm />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:gap-12">
            <div>
              <p className={columnHeading}>
                <T k="footer.browse" />
              </p>
              <div className={linkColumn}>
                {BROWSE_LINKS.map(({ href, k }) => (
                  <Link key={href} href={href} className={link}>
                    <T k={k} />
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <p className={columnHeading}>
                <T k="footer.depot" />
              </p>
              <div className={linkColumn}>
                <Link href="/about" className={link}>
                  <T k="footer.about" />
                </Link>
                <Link href="/saved" className={link}>
                  <T k="footer.saved" />
                </Link>
                <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
                  <T k="footer.contact" />
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-14 h-px bg-[#262626] sm:mt-[64px]" />
        <div className="flex items-center justify-between pt-5 font-mono text-[10px] uppercase tracking-[0.22em] text-white">
          <span>Dépôt</span>
          <FooterRegionMenu />
        </div>
      </div>
    </footer>
  );
}
