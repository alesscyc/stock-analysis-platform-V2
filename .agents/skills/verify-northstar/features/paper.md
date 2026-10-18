# Simulated Paper Account and reviewed orders

Users review an Entry Order, confirm a local Paper Order, inspect reservations/fills, modify prices, and recover a disposable simulation explicitly.

## Sub-features

- `paper-review`: Trade opens a right-side BUY/SELL ticket; reviewing creates no order.
- `paper-confirm`: Place Paper Order persists locally with no broker write.
- `paper-modify-fill`: price edits require confirmation; fresh quotes update holdings/cash.
- `paper-ownership`: secondary tab is read-only and takes ownership after primary closes.
- `paper-recovery`: corruption blocks writes; explicit reset and failed persistence behave safely.
- `paper-chart-drag`: dragging a draft entry/TP/SL line or a manageable working-order line edits that price through the same review flow as its button.

## How to get to it (user POV)

- Instrument Trade opens/restores the ticket; Buy/Sell chooses direction.
- Chart order lines/preview labels open a price-edit ticket; Orders offers Modify/cancel.
- Toggle account panel, Portfolio, Refresh account expose account state.
- Settings, Reset Paper Account opens explicit recovery controls.

## Driving it with agent-browser

Preconditions: only the isolated fixture regression (`npm run test:browser`), fresh $100,000 account, English UI. Never run these reset/confirmation actions in the user's session. Commands below are already automated by the harness; all share its session.

- **Review:** click Trade, `find label 'Limit price · USD' fill 90`, click Review order. Read the discovered Paper Account storage key and require zero orders. Capture the review ticket.
- **Confirm:** click Place Paper Order; require one persisted order and zero fixture broker writes. Quote initially 100, so BUY limit 90 remains pending/reserves cash.
- **Modify:** click Modify; set Limit price · USD to 91; click Review order. Stored price must still be 90. Click Confirm modification; require 91.
- **Fill:** harness changes the quote fixture to 89. Click Portfolio, then Refresh account. Require one NVDA share and cash 99911. Capture portfolio plus persisted values; fixture quote mutation alone is not the action proof.
- **Ownership:** harness opens another tab on the same fixture origin; Toggle account panel shows Read-only. Close primary tab; require automatic writable takeover and retained position.
- **Chart drag:** automated in `scripts/browser-check.mjs` (block "Order line dragging") with real `mouse move/down/up` on `.chart-overlays`. Covers nearest/topmost selection, preview-without-commit, sibling exits unchanged, no pan during drag, drawing-tool priority, saved drawing still selectable/deletable over a line, drag past plot edge then release (commits; pan and next drag recover), working-order line opening "Review order modification", zero orders submitted.
- **Recovery:** harness deliberately corrupts isolated storage and checks trading blocks without reset. Settings, Reset Paper Account, `find label 'New starting cash · USD' fill 25000`, `find label 'Type RESET to confirm' fill RESET`, then Permanently reset simulation produces startingCash 25000. A later injected quota failure must preserve the prior stored account and show Could not save Paper Account.

## Gotchas

- Static demo disables trading; a disabled ticket is not Paper execution proof.
- Bracket Order/Take-Profit Exit/Stop-Loss Exit, OCO, cancel, and IOC/FOK need dedicated assertions beyond this seeded recipe.
- Chart-drag gaps: touch input and Live/IB order lines are untested; `pointercancel` is synthetic fault injection (a mouse cannot produce a real one), so it proves the handler, not a browser-initiated cancel.
- Fixture broker writes are counted and rejected. Real Live mode can trade; use no broker credentials here.
- Reset is destructive only within the disposable test origin. Never clear another origin/profile or silently reset invalid user data.
