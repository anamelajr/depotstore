import Block from "./Block.js";

export default function EditorialBody({ entry }) {
  const { blocks, slug } = entry;
  return (
    <section className="px-6 md:px-10 pb-16 md:pb-20">
      <div className="flex flex-col gap-10 md:gap-14">
        {blocks.map((block, i) => (
          <Block key={i} block={block} slug={slug} />
        ))}
      </div>
    </section>
  );
}
