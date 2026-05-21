import { loadHomepagePicks } from "../../lib/loadHomepagePicks.js";
import PicksEditor from "./_components/PicksEditor.js";

export default async function HomepageEditPage() {
  const picks = await loadHomepagePicks();
  return <PicksEditor initialPicks={picks} />;
}
