import { GROUND } from "../../components/home/tokens";

// Tinted, not white: these pages render on GROUND, and the root loading.js
// falls back to bg-white — so navigating here used to flash a white sheet
// before the ground painted.
export default function ArchiveLoading() {
  return <div className="min-h-screen" style={{ backgroundColor: GROUND }} />;
}
