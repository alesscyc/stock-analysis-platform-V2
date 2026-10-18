# AI drafts and workspace preferences

Users ask contextual research questions, open unsubmitted drafts for review, change language, and use responsive panels.

## Sub-features

- `assistant-draft`: chat answer and validated draft open a ticket without executing an order.
- `workspace-language`: English/Traditional Chinese toggles and persists.
- `workspace-layout`: narrow screens keep chart, navigation, and ticket reachable.
- `workspace-settings`: language, service status, account JSON export, explicit reset.

## How to get to it (user POV)

- Toggle AI assistant in the navigation rail; chat model/input/Send, then Review in order ticket.
- Header Switch to Traditional Chinese, or Settings > Language.
- Settings exposes Export account JSON and reset (reset recipe is in paper.md).

## Driving it with agent-browser

Preconditions: `npm run test:browser` provides deepseek-test-fixture and a configured chat boundary. Do not send messages to an actual provider for this fixture proof. Commands describe its owned sequence.

- **Draft:** click Toggle AI assistant; wait for enabled `.research-chat-input`; fill `Explain this chart and draft an order.`; scroll `.research-chat-form .button.primary` into view and click Send. Require `.research-chat-draft` and exactly one fixture chat request.
- **Review:** scroll `.research-chat-draft .button.primary` into view, click Review in order ticket. Require visible `.sidebar .trade-panel`, no overlap with chat, zero pending Paper orders, and zero broker writes; click Cancel.
- **Responsive:** existing regression repeats draft review at 1000px and 390px, then checks chart handles at 800px. Require unobscured ticket and working rail, not merely matching DOM nodes.
- **Language:** click Watchlist, then Switch to Traditional Chinese; require `document.documentElement.lang === 'zh-TW'`. Set viewport 390x844, choose watchlist symbol, require sidebar closes and document width <=390. Capture `artifacts/browser-check-mobile.png`. Regression later restores English through fixture setup; add user-facing reload/toggle checks for a complete preference persistence proof.
- **Settings/export extension:** click Settings, inspect Workspace settings; select Language through its label and verify after reload. Click Export account JSON; inspect download contents and compare cash/positions to UI. These export/settings entry paths are mapped but not currently asserted by the browser regression.

## Gotchas

- Static preview supports language/settings UI but disables chat; no model response there is expected.
- Fixture chat is canned and tests drafts, not model quality or context privacy. Chat provider verification needs explicit configuration and sends supplied research/account context externally.
- Header language shortcut and Settings select are separate entry points. Each needs its own proof.
