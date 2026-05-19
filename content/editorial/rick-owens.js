const entry = {
  slug: "rick-owens",
  publishedAt: "2026-05-19",

  hero: {
    layout: "image-right",
    eyebrow: "Editorial",
    title: "Rick Owens",
    subtitle: "Black cloth, long shadows.\nA uniform for the beautiful outsider.",
    byline: "By DÉPÔT",
    images: ["hero.webp"],
    imageAlt: ["Rick Owens portrait in black"],
  },

  brandFilter: "Rick Owens",

  curatedProducts: [
    // Replace with real { storeDomain, handle } pairs from Supabase
    // once real curated items are picked. Stubs left here so the
    // section renders during development.
    { storeDomain: "esco.example", handle: "drkshdw-cropped-leather-cape" },
    { storeDomain: "esco.example", handle: "fw04-strobe-leather-jacket" },
    { storeDomain: "tagliatela.example", handle: "geobasket-high-black" },
    { storeDomain: "dotcomme.example", handle: "drape-wool-trouser-fw19" },
    { storeDomain: "esco.example", handle: "megalace-combat-boot" },
    { storeDomain: "tagliatela.example", handle: "cargo-pod-bomber-carbon" },
  ],

  blocks: [
    {
      type: "text",
      width: "narrow",
      dropcap: true,
      body: "Rick Owens builds clothes like shelter. Long lines, dropped crotches, warped leather, heavy boots, thin knits, and coats that move like architecture. The mood is severe, but never cold: part monastery, part nightclub, part desert ruin.",
    },
    { type: "section-heading", text: "Beauty, but scorched" },
    {
      type: "text",
      width: "narrow",
      body: "Owens made black feel expansive, not basic. His palette lives in ash, bone, dust, pearl, bruise, and pitch. The clothes look worn before they are worn, which is the point.",
    },
    {
      type: "image",
      src: "03.webp",
      width: "full-bleed",
      alt: "Full-length Rick Owens runway look with elongated black silhouette and heavy boots",
    },
    {
      type: "pullquote",
      text: "Working out is modern couture.",
      attribution: "Rick Owens",
    },
    {
      type: "text",
      width: "narrow",
      body: "The body matters in Rick Owens. Shoulders are exaggerated, legs are stretched, torsos are wrapped or exposed. The silhouette is not flattering in the usual way; it is commanding.",
    },
    { type: "section-heading", text: "The uniform cult" },
    {
      type: "text",
      width: "narrow",
      body: "A Rick Owens piece rarely behaves like a trend item. It becomes part of a personal system: one boot, one jacket, one perfect layer too many. The effect is private, protective, and instantly readable.",
    },
    {
      type: "image",
      src: "04.jpg",
      width: "full-bleed",
      alt: "Close-up of Rick Owens leather, draped jersey, raw seams, and dark textured materials",
    },
    { type: "section-heading", text: "Luxury with damage" },
    {
      type: "text",
      width: "narrow",
      body: "The materials carry the drama: washed leather, unstable jersey, shaved shearling, lacquered denim, rubber soles built like sculpture. Owens makes imperfection expensive without polishing it into politeness. That tension is the brand: elegance dragged through the dark and still standing.",
    },
  ],
};

export default entry;
