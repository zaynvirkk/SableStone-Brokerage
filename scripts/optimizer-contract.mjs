import { decimal, expectedProfitPriority, known } from "../dist/index.js";
const k=(value)=>known(decimal(value),"receipt"),result=expectedProfitPriority({monthlyVolumeKg:k("1000"),expectedCommissionPerKg:k("4"),expectedMonths:k("12"),physicalFillRatio:k("0.8"),closeProbability:k("0.25"),settlementGivenFundedProbability:k("0.7"),operationalComplexity:k("1.5"),expectedDaysToCash:k("30")},"HEURISTIC");
if(result.state!=="KNOWN"||result.value!=="149.333333")throw new Error(`optimizer mismatch ${JSON.stringify(result)}`);
const invalid=expectedProfitPriority({monthlyVolumeKg:k("1000"),expectedCommissionPerKg:k("4"),expectedMonths:k("12"),physicalFillRatio:k("1.1"),closeProbability:k("0.25"),settlementGivenFundedProbability:k("0.7"),operationalComplexity:k("1.5"),expectedDaysToCash:k("30")},"HEURISTIC");
if(invalid.state!=="UNKNOWN")throw new Error("invalid probability accepted");
console.log(`OPTIMIZER_OK value=${result.value} probabilities=non_overlapping`);
