export default function DesktopAboutSection({ description }) {
  if (!description) return null;

  return (
    <div className="hidden lg:grid lg:grid-cols-[1fr_1.4fr] gap-12 mt-16 pt-8 border-t border-zinc-200">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400 pt-1">
        About this piece
      </p>
      <p className="font-sans text-[14px] leading-[1.7] text-zinc-700 max-w-[60ch]">
        {description}
      </p>
    </div>
  );
}
