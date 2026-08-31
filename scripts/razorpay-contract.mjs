import { RazorpayRouteAdapter } from "../dist/index.js";
import { approval, credentials, draft, now } from "./settlement-fixture.mjs";
const provider="RAZORPAY_ROUTE", input=draft(provider); let rejected=0;
for(const [state,receipt] of [["INELIGIBLE",null],["UNDER_REVIEW","eligibility-review"],["ELIGIBLE",null]]) try{await new RazorpayRouteAdapter("SANDBOX",approval(provider),credentials(provider),state,receipt).createInstruction(input,now)}catch{rejected++}
const created=await new RazorpayRouteAdapter("SANDBOX",approval(provider),credentials(provider),"ELIGIBLE","eligibility-receipt").createInstruction(input,now);
if(!created.acknowledged||rejected!==3) throw new Error("Razorpay eligibility failed open");
console.log("RAZORPAY_OK ineligible=blocked under_review=blocked missing_receipt=blocked eligible_fixture=true identity_release_not_implied=true");
