# Real-World Accident & Risk Analysis — Srinivasa Store PWA

> **Context**: A small produce counter in Amangal, Telangana. The shopkeeper is often standing, serving customers quickly, hands possibly wet/oily from produce. Phone may be passed around. It's loud and busy.

---

## 🔴 Critical Risks (Can Cause Permanent Data Loss or Financial Error)

### 1. Double-Tap Creates Duplicate Bills
**What happens**: The owner taps "Save & Generate Bill" and nothing seems to happen for a split second (network lag, rendering). They tap again. Two identical bills are created with different bill numbers.

**Code location**: `saveBill()` — no guard against duplicate rapid submissions.

**Fix**: Disable the Save button immediately on first tap and re-enable only after saving is complete.
```js
// Add at start of saveBill():
const btn = document.getElementById('btn-save-bill');
if(btn.disabled) return;
btn.disabled = true;
// ... rest of save logic ...
btn.disabled = false; // at the end
```

---

### 2. No Way to Delete or Edit a Saved Bill
**What happens**: Owner enters wrong customer name (e.g., "Ramu" instead of "Ramesh"), or wrong quantity. Once saved, there is **zero way to fix it**. The wrong bill stays forever, corrupting the customer's ledger balance.

**Fix needed**: Add a **"🗑 Delete Bill"** option (with double confirm) and a **"✏️ Edit Bill"** option for bills created in the last 24 hours (before they could have been acted upon).

---

### 3. Partial Payment Over-Entry — No Confirmation
**What happens**: In the Ledger Detail, the "Record a Payment" field has `max="${due}"` set in HTML but the JS `recordPartialPayment()` does NOT validate the entered amount against the total due before applying it. If someone types ₹5000 when only ₹500 is due, the overflow is silently discarded — but no warning is shown and the user may believe the extra was recorded.

**Fix needed**: Validate entered amount against `totalDue` and show a toast warning before recording.

---

### 4. "Clear All Data" is Too Easy to Reach
**What happens**: In Settings, there is a single confirm() dialog before wiping **every bill and customer** in the database. A child playing with the phone or an accidental double-tap on "confirm" deletes months of data.

**Fix needed**: Double-confirmation — the user must type "DELETE" to confirm, not just tap OK.

---

### 5. billNo is Based on `records.length` — Not Unique After Deletion
**What happens**: Bill number is assigned as `records.length + 1`. If two bills are ever deleted, the next bill gets a duplicate number. Already a hidden bug.

**Fix**: Use a separate auto-incrementing counter in localStorage, like `srini_next_bill_no`.

---

## 🟠 High Risks (Financial Errors, Wrong Customer Data)

### 6. Two Customers with the Same Name — Ledger Confusion
**What happens**: Two different people named "Raju" buy on credit. Both get merged into the same customer entry (matched by name in `saveCustomer()`), making one "Raju" responsible for the other's debt.

**Fix needed**: When a new name is typed that matches an existing customer, show a prompt: *"A customer named 'Raju' already exists (C0012). Is this the same person?"* with Yes/No options.

---

### 7. WhatsApp Balance Message Sent to Wrong Number
**What happens**: Owner edits a phone number (common — numbers get changed), old number is saved, WhatsApp message gets delivered to a stranger with full financial balance details.

**Fix needed**: Before sending WhatsApp, show a preview of the phone number with a confirmation: *"Sending to +91-XXXXXX. Correct?"*

---

### 8. Partial Payment Field Accepts ₹0
**What happens**: Owner selects "Partial" payment status but enters ₹0 or leaves it blank. The bill is saved as "partial" with ₹0 paid — identical to "unpaid" but shown differently in the ledger. This distorts the count of partial vs. unpaid bills.

**Fix needed**: If payStatus is 'partial' and partialAmt is 0, automatically switch to 'unpaid' before saving.

---

### 9. Phone Number Can Be Cleared Accidentally
**What happens**: In the bill view, the Edit Phone panel pre-fills the existing number. The owner accidentally clears it and taps Save — the phone number is erased from all linked bills and the customer record.

**Fix needed**: If the field is cleared and the customer previously had a number, show a specific warning: *"This will remove the saved phone number. Are you sure?"*

---

## 🟡 Medium Risks (UX Accidents, Privacy)

### 10. No PIN Lock — Anyone Can See All Customer Financial Data
**What happens**: The phone is left unattended (common at counters). A curious customer, employee, or child picks it up and can see every customer's name, phone number, and how much debt they owe. This is sensitive financial data.

**Fix needed**: Optional 4-digit PIN lock on app open, stored as a hashed value in localStorage.

---

### 11. Call or App Switch Mid-Bill Loses Unsaved Progress
**What happens**: Owner starts a bill, a call comes in, they switch apps. When they return, the bottom sheet is closed but the partially-entered bill is gone. `addState` is reset every time `openAddBill()` is called.

**Fix needed**: Auto-save the current `addState` to `sessionStorage` every time an item is selected or a field is typed. Restore it if the sheet is re-opened within the same session.

---

### 12. Settings Sheet Has No "Back" Gesture Guard
**What happens**: Owner is in Settings, accidentally sets the Sheets URL to blank (clears it), then swipes down to close without noticing. URL is lost silently.

**Fix needed**: The Sheets URL field should only save on explicit button tap, not on `onchange`. Add a dedicated "Save URL" button instead.

---

### 13. Sync Button Accessible Offline — Gives Misleading Result
**What happens**: Owner taps "🔄 Sync Google Sheets" when there is no internet. The fetch fails, shows an error toast, but the owner thinks data is out of sync and starts recording payments again, creating duplicate entries.

**Fix needed**: Disable the Sync button and show a grayed-out state when `!navigator.onLine`. Re-enable automatically when back online.

---

### 14. No Auto-Backup Reminder
**What happens**: The Backup feature exists, but no one remembers to use it. If the browser cache is cleared after 3 months of billing, all data is gone with no recovery.

**Fix needed**: Show a subtle reminder toast once every 7 days: *"Tip: Last backup was 7 days ago. Export a backup in ⚙️ Settings."*

---

## 🟢 Low Risks (Minor Polish)

### 15. Large ₹ Amounts Not Validated — Possible Typos
**What happens**: Owner types ₹99999 when they meant ₹999 (fat-finger extra 9). No maximum or warning is shown.

**Fix**: Add a maximum bill amount validation (e.g., warn if single bill > ₹10,000) and ask for confirmation.

### 16. No "Last Modified" Timestamp on Bills
**What happens**: When a bill is marked paid or a phone number is added, there is no record of when that update happened. If a dispute arises ("I paid last Tuesday"), there is no audit trail timestamp.

**Fix**: Record `lastModified: Date.now()` on every bill update and show it in the bill view.

---

## 📋 Summary Priority Table

| # | Risk | Severity | Effort to Fix |
|---|---|:---:|:---:|
| 1 | Double-tap duplicate bills | 🔴 Critical | Low |
| 2 | No edit/delete bill | 🔴 Critical | High |
| 3 | Partial payment no validation | 🔴 Critical | Low |
| 4 | Clear All Data too easy | 🔴 Critical | Low |
| 5 | Duplicate bill numbers on delete | 🔴 Critical | Low |
| 6 | Same-name customer merging | 🟠 High | Medium |
| 7 | WhatsApp to wrong number | 🟠 High | Low |
| 8 | Partial payment saved as ₹0 | 🟠 High | Low |
| 9 | Phone number cleared accidentally | 🟠 High | Low |
| 10 | No PIN lock | 🟡 Medium | Medium |
| 11 | Unsaved bill lost on call/switch | 🟡 Medium | Medium |
| 12 | Settings URL cleared silently | 🟡 Medium | Low |
| 13 | Sync button shows error offline | 🟡 Medium | Low |
| 14 | No auto-backup reminder | 🟡 Medium | Low |
| 15 | Large amount typo | 🟢 Low | Low |
| 16 | No last-modified timestamp | 🟢 Low | Low |

---

## ✅ Which Should We Fix First?

**Immediate (low-effort, high-impact):**
- #1 Double-tap save guard
- #3 Partial payment validation
- #4 "Type DELETE" to clear all data
- #8 ₹0 partial payment auto-switch
- #9 Phone clear warning
- #12 Sheets URL save button
- #13 Disable Sync when offline
- #14 Backup reminder toast

**Next sprint:**
- #5 Fix bill number counter
- #6 Same-name customer warning
- #7 WhatsApp confirm number
- #11 Auto-save bill draft

**Planned feature:**
- #2 Edit/Delete bill
- #10 PIN lock
