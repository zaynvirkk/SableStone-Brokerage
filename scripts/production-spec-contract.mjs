import { deepCompatible } from "../dist/runtime/stage_handlers.js";
import { materialFamily } from "../dist/runtime/inbox_processors.js";

const demand={mfiMin:"10",mfiMax:"15",application:"injection",colour:"natural"};
if(!deepCompatible({mfiMin:"11",mfiMax:"14",application:"Injection",colour:"Natural"},demand))throw new Error("compatible production range rejected");
if(deepCompatible({mfiMin:"8",mfiMax:"14",application:"injection",colour:"natural"},demand))throw new Error("out-of-range lower MFI survived");
if(deepCompatible({mfiMin:"11",mfiMax:"16",application:"injection",colour:"natural"},demand))throw new Error("out-of-range upper MFI survived");
if(deepCompatible({application:"injection",colour:"natural"},demand))throw new Error("unknown required MFI survived");
if(deepCompatible({mfiMin:"11",mfiMax:"14",application:"film",colour:"natural"},demand))throw new Error("application mismatch survived");
if(deepCompatible({mfiMin:"invalid",mfiMax:"14",application:"injection",colour:"natural"},demand))throw new Error("invalid numeric specification survived");
const families=new Map([["rPP natural injection","RPP_NATURAL_LIGHT_INJECTION"],["rPP black injection","RPP_COLOURED_BLACK_INJECTION"],["rHDPE natural blow","RHDPE_NATURAL_BLOW_INJECTION"],["rHDPE coloured blow","RHDPE_COLOURED_BLACK_BLOW_INJECTION"],["rLLDPE film","RLLDPE_LDPE_FILM"],["PP prime","PP_PRIME_NON_PRIME"],["HDPE prime","HDPE_PRIME_NON_PRIME"],["LLDPE prime","LLDPE_PRIME_NON_PRIME"]]);
for(const [description,family] of families)if(materialFamily(description)!==family)throw new Error(`product ontology mismatch: ${description}`);
console.log("PRODUCTION_SPEC_CONTRACT_OK range=bounded unknown=blocked application=exact");
