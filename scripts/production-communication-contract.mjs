import { classifyInboundMime } from "../dist/connectors/communication_brain.js";

const mime = body => new TextEncoder().encode([
  "From: supplier@example.com",
  "To: brokerage@example.com",
  "Subject: Current stock",
  "Message-ID: <source@example.com>",
  "Content-Type: text/plain; charset=utf-8",
  "",
  body,
].join("\r\n"));

const complete = await classifyInboundMime(mime("120 MT rHDPE natural, MFI 0.4, net INR 88/kg, MOQ 20 MT"));
if (complete.classification !== "SUPPLIER_OFFER" || complete.state !== "PROPOSED" || !complete.offer) throw new Error("complete supplier offer not structured");
if (complete.offer.quantityMt !== "120" || complete.offer.moqMt !== "20" || complete.offer.netPerKg !== "88" || complete.offer.currency !== "INR") throw new Error("supplier economics parsed incorrectly");
if (complete.offer.verified !== false) throw new Error("message parser improperly verified supplier facts");
const international = await classifyInboundMime(mime("42 MT rPP natural, MFI 11-14, net USD 0.92/kg, MOQ 20 MT"));
if (!international.offer || international.offer.currency !== "USD" || international.offer.netPerKg !== "0.92") throw new Error("international supplier currency not preserved");

const incomplete = await classifyInboundMime(mime("120 MT HDPE available"));
if (incomplete.classification !== "SUPPLIER_OFFER" || incomplete.state !== "REQUEST_MISSING_FIELDS" || incomplete.offer !== null) throw new Error("incomplete supplier offer did not fail closed");

const forbidden = await classifyInboundMime(mime("We need you to finance us for 90 days"));
if (forbidden.state !== "DECLINE") throw new Error("credit request survived communication policy");

const withDocument = await classifyInboundMime(new TextEncoder().encode([
  "From: supplier@example.com",
  "To: brokerage@example.com",
  "Subject: Stock and COA",
  "Message-ID: <document@example.com>",
  "MIME-Version: 1.0",
  "Content-Type: multipart/mixed; boundary=boundary",
  "",
  "--boundary",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "120 MT rHDPE natural, MFI 0.4, net INR 88/kg, MOQ 20 MT",
  "--boundary",
  "Content-Type: application/pdf",
  "Content-Disposition: attachment; filename=coa.pdf",
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQKJSVFT0Y=",
  "--boundary--",
].join("\r\n")));
if (withDocument.classification !== "DOCUMENT" || !withDocument.offer || withDocument.offer.verified !== false) throw new Error("attached document suppressed commercial offer");

console.log("PRODUCTION_COMMUNICATION_CONTRACT_OK");
