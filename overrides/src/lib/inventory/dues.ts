import type { Entry, Payment } from "@/lib/inventory/api";
import { addDays, todayISO } from "@/lib/inventory/model";
import { daysBetween } from "@/lib/inventory/stock";

export type DueBill = { no: string; date: string; due: string; amount: number; left: number; lateDays: number };

export type DueRow = {
  company: string;
  creditDays: number;
  totalLeft: number;
  overdue: number;
  oldestLate: number;
  bills: DueBill[];
};

/**
 * What each customer still owes, bill by bill. Money received with a bill pays that bill;
 * separate payments pay the oldest bills first. A bill is late once its credit days have passed.
 */
export function dueRows(entries: Entry[], payments: Payment[], creditFor: (company: string) => number, today = todayISO()): DueRow[] {
  const companies = new Map<string, { bills: DueBill[]; received: number }>();
  const slot = (company: string) => {
    let row = companies.get(company);
    if (!row) {
      row = { bills: [], received: 0 };
      companies.set(company, row);
    }
    return row;
  };
  const byBill = new Map<string, DueBill & { company: string }>();
  for (const entry of entries) {
    if (entry.movement !== "delivery" || !entry.amountDue) continue;
    const key = `${entry.companyName}|${entry.billNo || entry.id}`;
    const left = Math.max(0, entry.amountDue - (entry.amountPaid ?? 0));
    const bill = byBill.get(key) ?? { company: entry.companyName, no: entry.billNo || "Entry", date: entry.entryDate, due: "", amount: 0, left: 0, lateDays: 0 };
    bill.amount += entry.amountDue;
    bill.left += left;
    if (entry.entryDate < bill.date) bill.date = entry.entryDate;
    byBill.set(key, bill);
  }
  for (const payment of payments) {
    if (payment.direction === "charge") {
      byBill.set(`${payment.companyName}|${payment.id}`, { company: payment.companyName, no: payment.receiptNo, date: payment.paidOn, due: "", amount: payment.amount, left: payment.amount, lateDays: 0 });
    } else if (payment.direction === "in") {
      slot(payment.companyName).received += payment.amount;
    }
  }
  for (const bill of byBill.values()) slot(bill.company).bills.push(bill);

  const rows: DueRow[] = [];
  for (const [company, data] of companies) {
    const creditDays = creditFor(company);
    let credit = data.received;
    const bills = data.bills.sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
    for (const bill of bills) {
      const used = Math.min(credit, bill.left);
      bill.left = Math.round((bill.left - used) * 100) / 100;
      credit -= used;
      bill.due = addDays(bill.date, creditDays);
      bill.lateDays = Math.max(0, daysBetween(bill.due, today));
    }
    const open = bills.filter((bill) => bill.left > 0.004);
    if (!open.length) continue;
    const late = open.filter((bill) => bill.lateDays > 0);
    rows.push({
      company,
      creditDays,
      totalLeft: Math.round(open.reduce((sum, bill) => sum + bill.left, 0) * 100) / 100,
      overdue: Math.round(late.reduce((sum, bill) => sum + bill.left, 0) * 100) / 100,
      oldestLate: late.reduce((max, bill) => Math.max(max, bill.lateDays), 0),
      bills: open,
    });
  }
  return rows.sort((a, b) => b.overdue - a.overdue || b.oldestLate - a.oldestLate || b.totalLeft - a.totalLeft);
}

export function reminderMessage(input: { yardName: string; row: DueRow; dmy: (iso: string) => string }) {
  const { row, yardName, dmy } = input;
  const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
  const late = row.bills.filter((bill) => bill.lateDays > 0);
  const list = (late.length ? late : row.bills).slice(0, 12).map((bill) => `• ${bill.no} dated ${dmy(bill.date)}: ${money(bill.left)}${bill.lateDays ? ` (due ${dmy(bill.due)})` : ""}`);
  return [
    `Namaste ${row.company},`,
    "",
    late.length ? `A friendly reminder that ${money(row.overdue)} is past due with ${yardName}:` : `Your balance with ${yardName} is ${money(row.totalLeft)}:`,
    ...list,
    "",
    late.length && row.totalLeft > row.overdue ? `Total balance including bills not yet due: ${money(row.totalLeft)}.` : "",
    "Kindly arrange the payment at the earliest. Please ignore this if already paid.",
    "Thank you!",
    yardName,
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}
