const entry = {
  slug: "rick-owens",
  publishedAt: "2026-05-19",

  hero: {
    layout: "image-right",
    eyebrow: "Editorial",
    title: "Rick Owens",
    subtitle: "The silhouette as architecture.\nThe body as subversion.",
    byline: "By DÉPÔT",
    images: ["hero.webp"],
    imageAlt: ["Rick Owens FW04 leather cape on concrete stairs."],
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
      body:
        "In a fashion landscape that rarely pauses, Rick Owens continues to create in shadow — unbothered, uncompromising, and entirely his own. For over three decades, he has built more than a brand; he has constructed a world.\n\nA world of long silhouettes, softened brutality, and a devotion to cut that borders on spiritual. Owens doesn't design for attention — he designs for presence.",
    },
    { type: "section-heading", text: "Architecture as attitude" },
    {
      type: "text",
      width: "narrow",
      body:
        "Owens has often spoken about architecture as the truest expression of clothing. His collections — temples of concrete, draped in silence — echo that belief. Shoulders become structures. Drapes fall like façades. Every seam, every fold, every shadow serves a purpose.",
    },
    {
      type: "image",
      src: "03.webp",
      width: "full-bleed",
      alt: "FW19 runway — concrete amphitheatre, draped wool.",
    },
    {
      type: "pullquote",
      text: "I am a designer of survivors. People who carry sadness with elegance.",
      attribution: "Rick Owens, 2004",
    },
    {
      type: "text",
      width: "narrow",
      body:
        "The quote is twenty years old. It still describes the cut of the FW24 cape — the way drape and weight conspire to make the body feel monumental, even at rest. Archive Owens reads like a sustained argument about how clothing should carry a person, not the other way around.",
    },
    {
      type: "image",
      src: "04.jpg",
      width: "wide",
      caption: "FW04 leather, slung shoulder.",
      alt: "FW04 leather jacket, slung shoulder, hanging on a mannequin.",
    },
    { type: "section-heading", text: "The materials, the palette" },
    {
      type: "text",
      width: "narrow",
      body:
        "Black, dust, oyster, slate. A palette that reads like weather. Leather that has been distressed, waxed, or boiled into something between fabric and architecture. Owens collaborates with mills the way a sculptor collaborates with stone — the material is never the constraint, it's the partner.",
    },
    {
      type: "image-pair",
      images: [
        { src: "05.webp", alt: "Boiled wool detail, FW18." },
        { src: "06.jpg", alt: "Dust-tone cashmere knit, SS21." },
      ],
    },
    {
      type: "text",
      width: "narrow",
      body:
        "To wear Owens is to take a position. About bodies, about volume, about whether clothing should comfort or confront. Three decades in, the position has only sharpened.",
    },
  ],
};

export default entry;
