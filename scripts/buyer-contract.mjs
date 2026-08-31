import { demand, now, qualifyBuyer, registration } from "./qualification-fixture.mjs";
const base = { demand, registration, buyerConfirmedAt: "2026-08-30T00:00:00Z", asksSableStoneForCredit: false, prohibitedUseClaim: false, currentCeilingConfirmed: true, now };
if (qualifyBuyer(base).verdict !== "PASS") throw new Error("valid buyer rejected");
const credit = qualifyBuyer({ ...base, asksSableStoneForCredit: true });
const staleCeiling = qualifyBuyer({ ...base, currentCeilingConfirmed: false });
const badUse = qualifyBuyer({ ...base, prohibitedUseClaim: true });
const standingUnknown = qualifyBuyer({ ...base, demand: { ...demand, standing: true } });
if ([credit, staleCeiling, badUse, standingUnknown].some((r) => r.verdict !== "FAIL")) throw new Error("buyer failed open");
console.log("BUYER_OK pass=true credit=fail stale_ceiling=fail prohibited_use=fail unknown_cadence=fail");
