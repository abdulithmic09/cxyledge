import type { CompanyBalance } from "@/lib/inventory/analyse";

/** Indian mobile numbers → wa.me format (country code, digits only). Empty when unusable. */
export function waNumber(raw: string | null | undefined): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return "";
}

function inr(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export function balanceMessage(input: { yardName: string; balance: CompanyBalance; today?: Date; statementUrl?: string }): string {
  const { yardName, balance } = input;
  const day = (input.today ?? new Date()).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  const lines = [`Namaste ${balance.company},`, "", `Your balance with ${yardName} as of ${day}:`];
  if (balance.outstandingQty > 0) {
    const types = balance.byType.length ? ` (${balance.byType.map((row) => `${row.type}: ${row.out}`).join(", ")})` : "";
    lines.push(`• Cylinders with you: ${balance.outstandingQty}${types}`);
    if (balance.outstandingSerials.length) {
      const shown = balance.outstandingSerials.slice(0, 25).join(", ");
      const more = balance.outstandingSerials.length > 25 ? ` and ${balance.outstandingSerials.length - 25} more` : "";
      lines.push(`• Serial nos.: ${shown}${more}`);
    }
  }
  if (balance.toCollect > 0) lines.push(`• Amount due: ${inr(balance.toCollect)}`);
  if (balance.toCollect <= 0 && balance.advance > 0) lines.push(`• Advance with us: ${inr(balance.advance)} (used on your next bills)`);
  if (balance.outstandingQty <= 0 && balance.toCollect <= 0 && balance.advance <= 0) lines.push("• Nothing pending. Thank you!");
  if (input.statementUrl) lines.push("", `Your full statement: ${input.statementUrl}`);
  lines.push("");
  const asks = [balance.outstandingQty > 0 ? "return the empty cylinders" : "", balance.toCollect > 0 ? "clear the amount due" : ""].filter(Boolean);
  if (asks.length) lines.push(`Kindly ${asks.join(" and ")} at the earliest.`);
  lines.push("Thank you!", yardName);
  return lines.join("\n");
}

export function whatsappLink(phone: string | null | undefined, text: string): string {
  const number = waNumber(phone);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
