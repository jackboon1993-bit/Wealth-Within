// Lightweight CSV parsing for the Import feature. No external dependency —
// handles quoted fields (including embedded commas/quotes) which a naive
// text.split(",") would break on for real bank exports.

function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

function normalizeHeader(h) {
  return (h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumn(headers, candidates) {
  for (let i = 0; i < headers.length; i++) {
    if (candidates.includes(headers[i])) return i;
  }
  return -1;
}

// Handles the common UK export formats: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD.
function parseUKDate(str) {
  if (!str) return null;
  const s = str.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return new Date(year, Number(m[2]) - 1, Number(m[1]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseAmount(str) {
  if (str == null) return null;
  const cleaned = str.replace(/[£,\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Parses a bank-exported transactions CSV. Auto-detects a Date column, a
 * Description column, and either a single signed Amount column or separate
 * Debit/Credit (Money out/Money in) columns.
 * Returns { transactions: [{ date: Date, description, amount }], error }
 * amount is signed: positive = money in, negative = money out.
 */
export function parseTransactionsCSV(text) {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return { transactions: [], error: "Couldn't find any transaction rows in this file." };

  const headers = rows[0].map(normalizeHeader);
  const dateIdx = findColumn(headers, ["date", "transactiondate", "posteddate", "completeddate"]);
  const descIdx = findColumn(headers, ["description", "narrative", "details", "reference", "merchant", "transactiondescription"]);
  const amountIdx = findColumn(headers, ["amount", "value", "transactionamount"]);
  const debitIdx = findColumn(headers, ["debit", "moneyout", "paidout", "withdrawal"]);
  const creditIdx = findColumn(headers, ["credit", "moneyin", "paidin", "deposit"]);

  if (dateIdx === -1 || descIdx === -1 || (amountIdx === -1 && debitIdx === -1 && creditIdx === -1)) {
    return {
      transactions: [],
      error:
        "Couldn't recognise the columns in this file. Expected a Date column, a Description column, and either an Amount column or separate Money in / Money out columns.",
    };
  }

  const transactions = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseUKDate(r[dateIdx]);
    const description = (r[descIdx] || "").trim();
    let amount = null;
    if (amountIdx !== -1) {
      amount = parseAmount(r[amountIdx]);
    } else {
      const debit = parseAmount(r[debitIdx]) || 0;
      const credit = parseAmount(r[creditIdx]) || 0;
      amount = credit - Math.abs(debit);
    }
    if (date && description && amount != null && amount !== 0) {
      transactions.push({ date, description, amount });
    }
  }

  if (transactions.length === 0) {
    return { transactions: [], error: "Recognised the columns but couldn't read any valid transaction rows." };
  }

  return { transactions, error: null };
}

/**
 * Parses a simple debts CSV: Name, Balance, Rate, Payment, and an optional
 * Type column ("loan" or "card" — anything else defaults to "loan").
 * Returns { debts: [{ name, balance, rate, payment, type }], error }
 */
export function parseDebtsCSV(text) {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return { debts: [], error: "Couldn't find any rows in this file." };

  const headers = rows[0].map(normalizeHeader);
  const nameIdx = findColumn(headers, ["name", "debtname", "account", "accountname"]);
  const balanceIdx = findColumn(headers, ["balance", "outstandingbalance", "amountowed"]);
  const rateIdx = findColumn(headers, ["rate", "interestrate", "apr"]);
  const paymentIdx = findColumn(headers, ["payment", "monthlypayment", "minimumpayment"]);
  const typeIdx = findColumn(headers, ["type", "debttype"]);

  if (nameIdx === -1 || balanceIdx === -1) {
    return {
      debts: [],
      error: "Couldn't recognise the columns. Expected at least a Name column and a Balance column (Rate and Payment are optional).",
    };
  }

  const debts = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[nameIdx] || "").trim();
    const balance = parseAmount(r[balanceIdx]);
    if (!name || balance == null) continue;
    const rate = rateIdx !== -1 ? parseAmount(r[rateIdx]) || 0 : 0;
    const payment = paymentIdx !== -1 ? parseAmount(r[paymentIdx]) || 0 : 0;
    const rawType = typeIdx !== -1 ? normalizeHeader(r[typeIdx]) : "";
    const type = rawType === "card" ? "card" : "loan";
    debts.push({ name, balance, rate, payment, type });
  }

  if (debts.length === 0) {
    return { debts: [], error: "Recognised the columns but couldn't read any valid debt rows." };
  }

  return { debts, error: null };
}
