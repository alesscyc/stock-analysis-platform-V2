# Stock Research and Trading

Canonical language for research, explicitly reviewed orders, and independent account views.

## Language

**Paper Account**:
The independent, local simulated account with simulated cash, whole-share holdings, and simulated orders.
_Avoid_: IB paper account, demo brokerage account

**Paper Mode**:
The trading mode in which user-approved actions affect only the Paper Account.
_Avoid_: offline mode, broker paper mode

**Live Mode**:
The trading mode that routes user-approved order requests through the connected Interactive Brokers account. That connection may belong to a real or broker-hosted paper account.
_Avoid_: guaranteed real-money account, production account

**IB Account**:
An account supplied by the connected Interactive Brokers service, separate from the local Paper Account.
_Avoid_: Paper Account

**Trading-mode preference**:
The user's saved choice of Paper Mode or Live Mode; the active mode can temporarily differ when IB is disconnected.
_Avoid_: active connection

**Display account**:
The IB Account selected for read-only overview. It is not the destination of new orders.
_Avoid_: routing account, active trading account

**Routing account**:
The configured destination for IB order submission, or the broker default when no destination is configured.
_Avoid_: display account

**Paper Order**:
A simulated whole-share order belonging exclusively to the Paper Account.
_Avoid_: IB order, broker order

**Order draft**:
Unsubmitted proposed order details that require validation and explicit user review before becoming an order.
_Avoid_: trade, executed signal

**Submission**:
An explicit request to create or change an order; it is not evidence of execution.
_Avoid_: fill, completed trade

**Fill**:
Execution of an order that changes cash and holdings, simulated locally for a Paper Order or reported by IB for a broker order.
_Avoid_: submission, acceptance

**Backtest action**:
A historical simulation annotation with no account or order authority.
_Avoid_: Paper Order, executed broker trade

**Model signal**:
A daily-data classification of a greater-than-5% forward return over 22 trading bars (BUY) versus other known outcomes (SELL).
_Avoid_: investment-success probability, execution instruction

**Primary tab**:
The one browser tab authorized to change the local Paper Account; other tabs may only read it.
_Avoid_: master account, broker session
