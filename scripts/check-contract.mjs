import { readFileSync } from "node:fs";

const product = readFileSync(new URL("../PRODUCT.md", import.meta.url), "utf8");
const required = [
  "SABLESTONE_INVENTORY = 0",
  "SABLESTONE_CARGO_CAPITAL = 0",
  "SABLESTONE_CREDIT_EXPOSURE = 0",
  "seller of record",
  "BUILD_VERIFIED",
];
for (const value of required) {
  if (!product.includes(value)) throw new Error(`missing product invariant: ${value}`);
}
console.log("CONTRACT_OK live capabilities disabled");
