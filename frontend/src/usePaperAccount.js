import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_STARTING_CASH,
  PAPER_ACCOUNT_LOCK_NAME,
  PAPER_ACCOUNT_STORAGE_KEY,
  applyPaperQuotes,
  cancelPaperOrder,
  createPaperAccount,
  expirePaperOrders,
  modifyPaperOrder,
  parsePaperAccount,
  submitPaperOrder,
  validatePaperAccount,
} from "./paperAccount.js";

const RETRY_LOCK_MS = 1500;
const ERROR_TRANSLATIONS = [
  [/^Paper Account is read-only/, "此分頁的模擬帳戶為唯讀。"],
  [/^Paper Account is unavailable/, "模擬帳戶無法使用；請明確重設後再試。"],
  [/^Could not save Paper Account/, "無法儲存模擬帳戶，交易已停用。"],
  [/^Insufficient available cash/, "可用現金不足。"],
  [/^Insufficient unreserved shares/, "未保留的持股數量不足。"],
  [/^Quantity must be a positive whole number/, "股數必須為正整數。"],
  [/^SELL brackets are not supported/, "模擬帳戶不支援賣出括號單。"],
  [/^BUY brackets require DAY or GTC/, "買入括號單僅支援 DAY 或 GTC。"],
  [/^Bracket exits must straddle/, "括號出場價格必須位於買入限價兩側。"],
  [/^Only order prices can be modified/, "只能修改委託價格。"],
  [/^Paper order is not active/, "委託已不再有效或已完成。"],
  [/^Invalid symbol/, "股票代號無效。"],
  [/^Invalid time in force/, "委託有效期限無效。"],
  [/^Invalid (?:limit |stop )?price/, "價格必須為有效正數。"],
  [/^Starting cash must be positive/, "初始資金必須大於零。"],
  [/^Amount exceeds supported range/, "金額超出支援範圍。"],
];

function bilingualError(cause) {
  const message =
    cause instanceof Error
      ? cause.message
      : String(cause || "Paper Account operation failed");
  if (message.includes(" / ")) return cause;
  const translation =
    ERROR_TRANSLATIONS.find(([pattern]) => pattern.test(message))?.[1] ||
    "請檢查輸入與帳戶狀態後重試。";
  return new Error(`${message} / ${translation}`, { cause });
}

/**
 * Browser-local Paper Account. Only the tab holding its exclusive Web Lock writes;
 * all mutations persist successfully before changing the published React snapshot.
 *
 * @returns {{account: object|null, ready: boolean, writable: boolean, error: string|null, primary: boolean,
 * submitOrder: Function, modifyOrder: Function, cancelOrder: Function, reset: Function, applyQuotes: Function}}
 */
export function usePaperAccount() {
  const [account, setAccount] = useState(null);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState(null);
  const [primary, setPrimary] = useState(false);
  const accountRef = useRef(null);
  const primaryRef = useRef(false);
  const lockOwnerRef = useRef(null);
  const faultRef = useRef(false);
  const queueRef = useRef(Promise.resolve());

  const mutate = useCallback((operation, allowFault = false) => {
    const task = queueRef.current.then(() => {
      if (!primaryRef.current)
        throw new Error("Paper Account is read-only in this tab");
      if (faultRef.current && !allowFault)
        throw new Error(
          "Paper Account is unavailable; explicit reset required",
        );
      let next;
      try {
        next = operation(accountRef.current);
        validatePaperAccount(next);
      } catch (cause) {
        throw cause;
      }
      if (next === accountRef.current) return next;
      try {
        globalThis.localStorage.setItem(
          PAPER_ACCOUNT_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch (cause) {
        faultRef.current = true;
        setWritable(false);
        setError(
          "Paper Account storage unavailable or unsavable; reset required. / 模擬帳戶儲存空間無法使用；請明確重設。",
        );
        throw new Error("Could not save Paper Account; trading disabled", {
          cause,
        });
      }
      accountRef.current = next;
      setAccount(next);
      if (allowFault) {
        faultRef.current = false;
        setError(null);
      }
      setWritable(!faultRef.current);
      return next;
    });
    const exposed = task.catch((cause) => {
      throw bilingualError(cause);
    });
    queueRef.current = exposed.catch(() => {});
    return exposed;
  }, []);

  const submitOrder = useCallback(
    (ticket) => mutate((current) => submitPaperOrder(current, ticket)),
    [mutate],
  );
  const modifyOrder = useCallback(
    (id, patch) => mutate((current) => modifyPaperOrder(current, id, patch)),
    [mutate],
  );
  const cancelOrder = useCallback(
    (id) => mutate((current) => cancelPaperOrder(current, id)),
    [mutate],
  );
  const applyQuotes = useCallback(
    (quotes) => mutate((current) => applyPaperQuotes(current, quotes)),
    [mutate],
  );
  const reset = useCallback(
    (startingCash = DEFAULT_STARTING_CASH) =>
      mutate(() => createPaperAccount(startingCash), true),
    [mutate],
  );

  useEffect(() => {
    let cancelled = false;
    let acquiring = false;
    let retryTimer;
    let releaseLock;
    let lease;

    const publish = (snapshot, message = null, damaged = false) => {
      if (cancelled) return;
      accountRef.current = snapshot;
      faultRef.current = damaged;
      setAccount(snapshot);
      setError(message);
      setReady(true);
      setWritable(primaryRef.current && !!snapshot && !damaged);
    };

    const readOnlySnapshot = (message) => {
      let raw;
      try {
        raw = globalThis.localStorage.getItem(PAPER_ACCOUNT_STORAGE_KEY);
      } catch {
        publish(
          null,
          "Paper Account storage unavailable. / 模擬帳戶儲存空間無法使用。",
          true,
        );
        return;
      }
      if (raw === null) {
        publish(
          null,
          message ||
            "Paper Account not initialized; waiting for primary tab. / 模擬帳戶尚未初始化，等待主要分頁。",
        );
        return;
      }
      try {
        publish(parsePaperAccount(raw), message);
      } catch {
        publish(
          null,
          "Paper Account data invalid; explicit reset required. / 模擬帳戶資料無效；請明確重設。",
          true,
        );
      }
    };

    const initializePrimary = () => {
      let storage;
      let raw;
      try {
        storage = globalThis.localStorage;
        raw = storage.getItem(PAPER_ACCOUNT_STORAGE_KEY);
      } catch {
        publish(
          null,
          "Paper Account storage unavailable; explicit reset required. / 模擬帳戶儲存空間無法使用；請明確重設。",
          true,
        );
        return;
      }
      if (raw === null) {
        try {
          const fresh = createPaperAccount();
          storage.setItem(PAPER_ACCOUNT_STORAGE_KEY, JSON.stringify(fresh));
          publish(fresh);
        } catch {
          publish(
            null,
            "Paper Account storage unsavable; explicit reset required. / 模擬帳戶無法儲存；請明確重設。",
            true,
          );
        }
        return;
      }
      let loaded;
      try {
        loaded = parsePaperAccount(raw);
      } catch {
        publish(
          null,
          "Paper Account data invalid; explicit reset required. / 模擬帳戶資料無效；請明確重設。",
          true,
        );
        return;
      }
      try {
        const expired = expirePaperOrders(loaded);
        if (expired !== loaded)
          storage.setItem(PAPER_ACCOUNT_STORAGE_KEY, JSON.stringify(expired));
        publish(expired);
      } catch {
        publish(
          null,
          "Paper Account storage unsavable; explicit reset required. / 模擬帳戶無法儲存；請明確重設。",
          true,
        );
      }
    };

    const onStorage = (event) => {
      if (event.key !== PAPER_ACCOUNT_STORAGE_KEY && event.key !== null) return;
      if (primaryRef.current) {
        faultRef.current = true;
        setWritable(false);
        setError(
          "Paper Account changed outside this tab; explicit reset required. / 模擬帳戶在此分頁外遭到變更；請明確重設。",
        );
        return;
      }
      let raw;
      try {
        raw = globalThis.localStorage.getItem(PAPER_ACCOUNT_STORAGE_KEY);
      } catch {
        publish(
          null,
          "Paper Account storage unavailable. / 模擬帳戶儲存空間無法使用。",
          true,
        );
        return;
      }
      if (raw === null) {
        publish(
          null,
          "Paper Account not initialized; waiting for primary tab. / 模擬帳戶尚未初始化，等待主要分頁。",
        );
        return;
      }
      try {
        publish(parsePaperAccount(raw));
      } catch {
        publish(
          null,
          "Paper Account data invalid; explicit reset required. / 模擬帳戶資料無效；請明確重設。",
          true,
        );
      }
    };

    globalThis.addEventListener?.("storage", onStorage);

    let locks;
    try {
      locks = globalThis.navigator?.locks;
    } catch {
      locks = null;
    }
    if (!locks?.request) {
      readOnlySnapshot(
        "Read-only: browser Web Locks unavailable. / 唯讀：瀏覽器不支援 Web Locks。",
      );
      return () => {
        cancelled = true;
        globalThis.removeEventListener?.("storage", onStorage);
      };
    }

    const attemptLock = async () => {
      if (cancelled || acquiring || primaryRef.current) return;
      acquiring = true;
      let retry = false;
      try {
        const outcome = await new Promise((resolve) => {
          let settled = false;
          const finish = (value) => {
            if (!settled) {
              settled = true;
              resolve(value);
            }
          };
          try {
            const request = locks.request(
              PAPER_ACCOUNT_LOCK_NAME,
              { mode: "exclusive", ifAvailable: true },
              async (lock) => {
                if (!lock) {
                  finish("busy");
                  return;
                }
                if (cancelled) {
                  finish("cancelled");
                  return;
                }
                lease = {};
                lockOwnerRef.current = lease;
                primaryRef.current = true;
                setPrimary(true);
                finish("acquired");
                await new Promise((release) => {
                  releaseLock = release;
                  if (cancelled) release();
                });
                if (lockOwnerRef.current === lease) {
                  lockOwnerRef.current = null;
                  primaryRef.current = false;
                  setPrimary(false);
                  setWritable(false);
                }
              },
            );
            request.catch((cause) => finish({ error: cause }));
          } catch (cause) {
            finish({ error: cause });
          }
        });

        if (cancelled) return;
        if (outcome === "acquired") initializePrimary();
        else if (outcome === "busy") {
          retry = true;
          readOnlySnapshot(
            "Read-only: another tab owns Paper Account. / 唯讀：另一個分頁正在使用模擬帳戶。",
          );
        } else if (outcome !== "cancelled")
          readOnlySnapshot(
            "Read-only: browser Web Lock failed. / 唯讀：瀏覽器 Web Lock 發生錯誤。",
          );
      } finally {
        acquiring = false;
        if (retry && !cancelled && !primaryRef.current)
          retryTimer = setTimeout(attemptLock, RETRY_LOCK_MS);
      }
    };

    void attemptLock();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      globalThis.removeEventListener?.("storage", onStorage);
      if (lease && lockOwnerRef.current === lease) {
        lockOwnerRef.current = null;
        primaryRef.current = false;
        setPrimary(false);
        setWritable(false);
      }
      if (releaseLock) releaseLock();
    };
  }, []);

  useEffect(() => {
    if (!primary || !writable || !account) return undefined;
    const deadlines = account.orders
      .filter((order) => order.tif === "DAY")
      .map((order) => Date.parse(order.expiresAt));
    if (!deadlines.length) return undefined;
    const delay = Math.max(0, Math.min(...deadlines) - Date.now());
    const timer = setTimeout(
      () => {
        void mutate((current) => expirePaperOrders(current)).catch(() => {});
      },
      Math.min(delay, 2_147_000_000),
    );
    return () => clearTimeout(timer);
  }, [account, primary, writable, mutate]);

  return {
    account,
    ready,
    writable,
    error,
    primary,
    submitOrder,
    modifyOrder,
    cancelOrder,
    reset,
    applyQuotes,
  };
}

export default usePaperAccount;
