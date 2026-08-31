import Link from "next/link";import {Shell} from "./components";
export default function NotFound(){return <Shell current=""><section className="empty"><h1>Docket not found</h1><p>The reference may be invalid or outside your role. No identity or trade data was disclosed.</p><Link className="primary" href="/operations">Return to operations</Link></section></Shell>}
