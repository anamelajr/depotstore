// #f5f2ed is the article's own ground (see page.js). Tinted, not white: the
// root loading.js falls back to bg-white, so navigating here used to flash a
// white sheet before the ground painted.
export default function EditorialLoading() {
  return <div className="min-h-screen bg-[#f5f2ed]" />;
}
