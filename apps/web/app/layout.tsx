import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "SableStone Brokerage", description: "Protected polymer brokerage operations" };
const directionContract = `
THESIS: One receipt-backed trade docket; refuse the generic metric-card dashboard.
OWN-WORLD: Paper-white docket, carbon blue rules, graphite ink, safety amber, rectangular stamps and perforation marks.
STORY: Read exact evidence, see the deterministic block, complete only the permitted next transition.
FIRST VIEWPORT: Narrow register navigation, full trade sheet, state rail, compatibility ledger, right decision strip, primary action inside the strip.
FORM: Grounded direction 3, continuous weighbridge dispatch docket; seed 80369743.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><template data-direction-contract="80369743" dangerouslySetInnerHTML={{ __html: `<!-- ${directionContract} -->` }} />{children}</body></html>;
}
