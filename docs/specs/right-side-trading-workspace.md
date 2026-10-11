# Right-side trading workspace

## Problem Statement

Live Mode interrupts switching with a confirmation and adds a persistent banner. Separate Buy/Sell entry buttons, left-side navigation, and bottom status sections clutter the chart workspace.

## Solution

Remove the Live Mode switch confirmation and persistent LIVE ROUTE banner. Replace instrument Buy/Sell buttons with one Trade button that opens an order ticket in a right-side panel matching the existing research panels. Move the navigation rail and research panels to the right. Remove the chart bar-count footer and application Local workspace footer, preserving loading and history failure information elsewhere.

The user confirmed all three scope questions and requested a local specification rather than issue-tracker publication.

## User Stories

1. As a researcher, I want navigation on the right so the chart occupies the left/main workspace.
2. As a researcher, I want Watchlist, Screener, and Backtest panels on the right while retaining their existing functions and resize controls.
3. As a trader, I want one Trade button instead of separate instrument Buy/Sell buttons.
4. As a trader, I want the order ticket in a right-side panel consistent with the research panel presentation.
5. As a trader, I want to choose Buy or Sell inside the ticket, with no submission merely from opening it or changing side.
6. As a trader, I want to switch to connected Live Mode without a confirmation popup or persistent LIVE ROUTE banner.
7. As a trader, I want mode indicators, connection/storage failures, review and submission safeguards, and ticket invalidation on mode changes to remain effective.
8. As a researcher, I want the chart bar-count footer and Local workspace application footer removed to reclaim space.
9. As a researcher, I want older-history loading and failure information preserved outside the removed footer.
10. As a narrow-screen user, I want right-side panels to remain usable without horizontal page overflow or losing chart navigation.
11. As a bilingual user, I want the changed controls and notices to retain English and Traditional Chinese support.
12. As a trader, I want existing modification tickets, chart previews, and AI drafts to continue using the same validated review/submission flow.

## Implementation Decisions

- Reuse existing workspace layout, research panel styling, ticket logic, and resize controls; do not introduce dependencies or new APIs.
- Update workspace orchestration, panel styling, order-ticket presentation, and chart status placement together.
- Trade opens an unsubmitted BUY draft only when no draft exists; Buy/Sell selection remains inside the ticket.
- Switching to Watchlist, Screener, or Backtest keeps the unfinished ticket, including side, quantity, prices, bracket choices, and review stage. Trade restores that ticket rather than replacing it. The user explicitly chose to keep drafts. Explicit cancellation, successful submission, or mode/symbol invalidation still clears the ticket.
- Keep ticket review, explicit submission, Live acknowledgement, cancellation, validation, and mode/symbol invalidation intact. Preserve Escape-to-close and focus transfer/restoration; do not close a submitting ticket via Escape.
- AI-generated drafts and order edits open the same right-side ticket.
- The Trade panel must not overlap other panels or leave the user unable to close/reopen it; use existing panel interaction conventions for simultaneous panels and narrow screens.
- Remove only the switch confirmation and persistent Live banner, not disconnection or storage warnings or risk information in the ticket/account views.
- Remove both entire bottom footer sections, not merely their text. Place older-history status in the chart's remaining interface.
- Keep the account panel and its portfolio/orders tabs; the removed application footer is not the account panel.
- Retain demo trade disabling and visible generated-data labeling.
- No account data/schema changes and no change to IB routing.

## Testing Decisions

- Extend the existing isolated browser regression, the highest existing seam, testing rendered behavior rather than source text.
- The fixture serves local canned market/account/chat responses and has no IB client or credentials; assert zero unintended broker writes.
- Assert one instrument Trade entry, both in-ticket sides, right-side placement and panel interaction, absent removed footers, preserved partial-history status, and usable narrow-screen layouts.
- Assert a connected Paper-to-Live switch does not invoke confirmation, the LIVE ROUTE banner is absent, mode indicators remain correct, and disconnection/storage failure safeguards remain intact.
- Preserve existing order review, submission, modification, paper persistence, AI draft, backtest, and bilingual cases.
- Check draft retention across research menus, Escape/focus behavior, chart attribution, and AI-to-ticket transitions at intermediate and mobile widths as well as desktop.
- Run existing automated tests, production build, and browser regression. Run lint/type checks if configured; otherwise report that they are not configured.

## Out of Scope

- Broker routing, API authentication, simulator changes, new trading features, and real-money/broker-connected testing.
- Rebuilding unrelated panels, adding dependencies, desktop packaging, or introducing new general-purpose panel frameworks.

## Further Notes

This is a two-way-door UI change. Blast radius: workspace layout, ticket presentation, and associated browser regression assertions. Switching to Live Mode still permits real-money orders; removal of the switch warning does not remove explicit order authorization. Canonical trading terminology remains defined in the existing domain documentation.
