import { useCallback, useEffect, useState } from "react";
import { api, DEMO } from "./api.js";
import { paperSummary } from "./paperAccount.js";

export function useHealth() {
  const [health, setHealth] = useState({
    status: "connecting",
    analysis: false,
    ib: { connected: false },
    desktop: false,
  });
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const next = await api("/health", { signal: controller.signal });
        if (!controller.signal.aborted) setHealth(next);
      } catch (e) {
        if (!controller.signal.aborted)
          setHealth({
            status: "offline",
            analysis: false,
            ib: { connected: false },
            error: e.message,
          });
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 10000);
      }
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return health;
}
export function useLiveAccount(enabled, displayAccount) {
  const [data, setData] = useState({
    account: null,
    defaultAccount: null,
    accounts: [],
    orders: [],
    ordersReady: false,
    error: null,
    ordersError: null,
    refreshing: false,
  });
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((n) => n + 1), []);
  useEffect(() => {
    setData((previous) => ({
      ...previous,
      account: null,
      defaultAccount: null,
      orders: [],
      ordersReady: false,
      error: null,
    }));
    if (!enabled || DEMO) return;
    const controller = new AbortController(),
      signal = controller.signal;
    let timer;
    const update = (patch) => {
      if (!signal.aborted) setData((previous) => ({ ...previous, ...patch }));
    };
    async function poll() {
      update({ refreshing: true });
      const opts = { signal };
      await Promise.all([
        api(
          `/account${displayAccount ? `?account=${encodeURIComponent(displayAccount)}` : ""}`,
          opts,
        )
          .then((account) =>
            update({
              account,
              ...(!displayAccount ? { defaultAccount: account } : {}),
              error: null,
            }),
          )
          .catch((e) => update({ error: e.message })),
        displayAccount
          ? api("/account", opts)
              .then((defaultAccount) => update({ defaultAccount }))
              .catch(() => update({ defaultAccount: null }))
          : Promise.resolve(),
        api("/accounts", opts)
          .then((result) => update({ accounts: result.accounts || [] }))
          .catch((e) => update({ error: e.message })),
        api("/orders", opts)
          .then((result) =>
            update({
              orders: (result.orders || []).filter(
                (o) =>
                  ![
                    "Filled",
                    "Cancelled",
                    "ApiCancelled",
                    "Inactive",
                    "filled",
                    "cancelled",
                    "expired",
                  ].includes(o.status),
              ),
              ordersReady: true,
              ordersError: null,
            }),
          )
          .catch((e) => update({ ordersReady: false, ordersError: e.message })),
      ]);
      update({ refreshing: false });
      if (!signal.aborted) timer = setTimeout(poll, 10000);
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, displayAccount, token]);
  return { ...data, refresh };
}
export function paperOverview(account) {
  if (!account) return null;
  const overview = paperSummary(account);
  const quoteTimes = account.positions
    .map((p) => Date.parse(account.quotes[p.symbol]?.asOf))
    .filter(Number.isFinite);
  return {
    ...overview,
    asOf: quoteTimes.length
      ? new Date(Math.min(...quoteTimes)).toISOString()
      : account.updatedAt,
  };
}
