# Order line dragging

## Problem Statement

Order prices can be edited by dragging their chart buttons, but traders cannot grab the corresponding horizontal lines.

## Solution

Make editable entry, stop-loss, and take-profit lines draggable using the existing button-editing flow.

## User Stories

1. As a trader, I want to drag a draft entry line so I can set its price directly on the chart.
2. As a trader, I want to drag draft stop-loss and take-profit lines so I can adjust bracket prices.
3. As a trader, I want to drag a manageable working-order line so I can open its modification ticket at the chosen price.
4. As a trader, I want existing buttons to remain usable so I retain precise selection and keyboard access.
5. As a trader, I want transient price previews and cancellation so an interrupted drag does not commit changes.
6. As a trader, I want nearby lines selected by distance so I can grab the intended price.
7. As a chart user, I want drawing tools to retain priority so order lines do not intercept drawing gestures.
8. As a trader, I want existing review and submission rules preserved so dragging never submits an order.

## Implementation Decisions

Dragging an editable order's horizontal price line must perform the same action as dragging its existing price button. Button dragging remains available.

Reuse existing behavior for entry, stop-loss, and take-profit prices on draft tickets and manageable working orders. Preserve price previews, cent rounding, cancellation, validation, and review/submission timing. Moving entry does not move sibling exit prices.

Draft changes update the ticket; working-order changes open a modification ticket. Dragging does not submit an order. Positions and non-editable orders remain non-editable.

## Confirmed interaction decisions

- The full horizontal price line is draggable, with an invisible 10px-tall hit area centered on the visible line.
- Line dragging takes priority over chart panning. An active drawing tool takes priority over line dragging.
- When editable line hit areas overlap, select the line nearest the pointer vertically. Resolve exact ties using visible stacking order, with the topmost line selected.
- Existing buttons remain available for selecting orders whose lines are covered by another line.

## Testing Decisions

Use the existing isolated browser regression as the highest test seam. Exercise real pointer gestures through the rendered chart for draft and working orders, overlapping lines, cancellation, and drawing priority. Retain existing button and keyboard behavior checks. Test visible outcomes and ticket state rather than implementation details. Run existing automated tests and production build; run lint/type checks if configured.

The fixture supplies market/account responses without broker credentials. Assert no unintended broker writes. A fixture result does not certify live integrations.

## Out of Scope

New order types, sibling-price movement, backend/API/schema changes, dependencies, broker-connected testing, and editing positions or non-manageable orders.

## Further Notes

The user confirmed all interaction decisions and the browser verification seam, then requested the multi-agent implementation workflow through T3 Code. This is a reversible UI change. Blast radius: chart price overlays, their gesture handling, and fixture browser regression coverage.
