import { randomUUID } from 'node:crypto';
import { IBApi, EventName, OrderAction, OrderType, Stock } from '@stoqey/ib';
import { HttpError } from './errors.js';
import { validateOrderTicket, validatePricePatch } from './validation.js';

const SUMMARY_TAGS = 'NetLiquidation,TotalCashValue,BuyingPower,AvailableFunds,ExcessLiquidity,MaintMarginReq,GrossPositionValue';
const TERMINAL = new Set(['Filled', 'Cancelled', 'ApiCancelled', 'Inactive']);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function errorText(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown IB error');
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function waitTimer(callback, ms) {
  const timer = setTimeout(callback, ms);
  timer.unref?.();
  return timer;
}

function releaseListener(emitter, event, listener) {
  if (typeof emitter.off === 'function') emitter.off(event, listener);
  else emitter.removeListener?.(event, listener);
}

export function maskAccountId(id) {
  if (typeof id !== 'string' || !id) return 'Account';
  return id.length <= 4 ? '••••' : `${id.slice(0, 2)}••••${id.slice(-4)}`;
}

export class IbAdapter {
  constructor({ config = {}, ibApiFactory, requestTimeoutMs = 8000, snapshotMaxAgeMs = 90000, reconnectMs = 5000, now = Date.now } = {}) {
    this.config = {
      host: config.host || '127.0.0.1',
      port: Number(config.port || 7497),
      clientId: Number(config.clientId ?? 17),
      account: typeof config.account === 'string' ? config.account.trim() : '',
    };
    this.requestTimeoutMs = requestTimeoutMs;
    this.snapshotMaxAgeMs = snapshotMaxAgeMs;
    this.reconnectMs = reconnectMs;
    this.now = now;
    this.ib = ibApiFactory
      ? ibApiFactory({ host: this.config.host, port: this.config.port })
      : new IBApi({ host: this.config.host, port: this.config.port });
    this.connected = false;
    this.ready = false;
    this.error = undefined;
    this.running = false;
    this.reconnectTimer = undefined;
    this.accounts = [];
    this.accountsKnown = false;
    this.accountWaiters = new Set();
    this.nextRequestId = 1000;
    this.nextOrderId = null;
    this.maxObservedOrderId = -1;
    this.summaryRequest = null;
    this.openOrdersRequest = null;
    this.openOrderRefresh = null;
    this.ignoreLateOpenOrders = false;
    this.summaryCache = new Map();
    this.positionsCache = new Map();
    this.positionRequest = null;
    this.portfolioRequest = null;
    this.ordersByRef = new Map();
    this.orderStatusById = new Map();
    this.openOrderRefs = new Set();
    this.orderQueue = Promise.resolve();
    this._bindEvents();
  }

  _bindEvents() {
    this.ib.on(EventName.connected, () => {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      this._resetOrderCache('IB connection restarted');
      this.connected = true;
      this.ready = false;
      this.error = undefined;
      this.accounts = [];
      this.accountsKnown = false;
      this.nextOrderId = null;
      this.maxObservedOrderId = -1;
      this.ib.reqManagedAccts();
      this.ib.reqIds();
    });
    const disconnected = () => {
      this.connected = false;
      this._resetOrderCache('IB connection closed');
      this.ready = false;
      this.accounts = [];
      this.accountsKnown = false;
      this.nextOrderId = null;
      this.maxObservedOrderId = -1;
      if (this.running && !this.error) this.error = 'Disconnected from IB Gateway/TWS';
      this._scheduleReconnect();
    };
    this.ib.on(EventName.disconnected, disconnected);
    this.ib.on(EventName.connectionClosed, disconnected);
    this.ib.on(EventName.managedAccounts, (raw) => {
      this.accounts = String(raw || '').split(',').map((id) => id.trim()).filter(Boolean);
      this.accountsKnown = true;
      this._updateReady();
      for (const resolve of this.accountWaiters) resolve(this.accounts);
      this.accountWaiters.clear();
    });
    this.ib.on(EventName.error, (error, code) => {
      const message = errorText(error);
      this.error = code === undefined ? message : `${message} (IB ${code})`;
      if (!this.connected) this._scheduleReconnect();
    });
    this.ib.on(EventName.nextValidId, (id) => {
      if (Number.isInteger(id) && id >= 0) {
        this.nextOrderId = Math.max(this.nextOrderId ?? id, id, this.maxObservedOrderId + 1);
        this._updateReady();
      }
    });
    this.ib.on(EventName.updatePortfolio, (contract, quantity, marketPrice, marketValue, averageCost, unrealizedPnl, realizedPnl, account) => {
      const request = this.portfolioRequest;
      if (!request) return;
      if (contract?.secType !== 'STK') {
        if (Number(quantity) !== 0) request.excludedNonStock = true;
        return;
      }
      if (contract.currency !== 'USD') {
        if (Number(quantity) !== 0) request.excludedNonUsd = true;
        return;
      }
      request.rows.push({
        account: account || request.account,
        symbol: contract?.symbol || '',
        quantity: Number(quantity),
        averageCost: toNumber(averageCost),
        marketPrice: toNumber(marketPrice),
        marketValue: toNumber(marketValue),
        unrealizedPnl: toNumber(unrealizedPnl),
        realizedPnl: toNumber(realizedPnl),
      });
    });
    this.ib.on(EventName.accountDownloadEnd, (account) => {
      const request = this.portfolioRequest;
      if (request && account === request.account) request.finish(null, request.rows);
    });
    this.ib.on(EventName.openOrder, (orderId, contract, order, state) => this._recordOpenOrder(orderId, contract, order, state));
    this.ib.on(EventName.openOrderEnd, () => { this.ignoreLateOpenOrders = false; });
    this.ib.on(EventName.orderStatus, (orderId, status, filled, remaining, avgFillPrice, _permId, _parentId, _lastFillPrice, clientId) => {
      const owner = clientId ?? this.config.clientId;
      this.orderStatusById.set(`${owner}:${orderId}`, { status, filled: toNumber(filled), remaining: toNumber(remaining), avgFillPrice: toNumber(avgFillPrice) });
      for (const [ref, item] of this.ordersByRef) {
        if (item.orderId !== orderId || item.clientId !== owner) continue;
        item.status = status;
        item.filled = toNumber(filled);
        item.remaining = toNumber(remaining);
        if (TERMINAL.has(status)) {
          this.openOrderRefs.delete(ref);
          this.openOrderRefresh?.refs.delete(ref);
        }
      }
    });
  }

  _resetOrderCache(reason) {
    this.openOrderRefresh?.finish(new HttpError(503, reason));
    this.ordersByRef.clear();
    this.orderStatusById.clear();
    this.openOrderRefs.clear();
    this.openOrderRefresh = null;
    this.openOrdersRequest = null;
    this.ignoreLateOpenOrders = false;
  }

  _updateReady() {
    this.ready = this.connected && this.accountsKnown && Number.isInteger(this.nextOrderId);
  }

  status() {
    const result = { connected: this.connected };
    if (this.error) result.error = this.error;
    return result;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._connect();
  }

  stop() {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.connected || this.ib.isConnected) this.ib.disconnect();
    this.connected = false;
  }

  _connect() {
    if (!this.running || this.connected) return;
    try {
      this.ib.connect(this.config.clientId);
    } catch (error) {
      this.error = errorText(error);
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (!this.running || this.reconnectTimer) return;
    this.reconnectTimer = waitTimer(() => {
      this.reconnectTimer = undefined;
      this._connect();
    }, this.reconnectMs);
  }

  async getManagedAccounts() {
    if (!this.connected) throw new HttpError(503, this.error || 'IB Gateway/TWS is not connected');
    if (this.accountsKnown) return [...this.accounts];
    const accounts = await new Promise((resolve, reject) => {
      const timer = waitTimer(() => {
        this.accountWaiters.delete(onAccounts);
        reject(new HttpError(504, 'Timed out waiting for IB accounts'));
      }, this.requestTimeoutMs);
      const onAccounts = (items) => {
        clearTimeout(timer);
        resolve(items);
      };
      this.accountWaiters.add(onAccounts);
      try { this.ib.reqManagedAccts(); } catch (error) {
        clearTimeout(timer);
        this.accountWaiters.delete(onAccounts);
        reject(new HttpError(503, errorText(error)));
      }
    });
    return [...accounts];
  }

  async getDefaultAccountSnapshot() {
    const accounts = await this.getManagedAccounts();
    const accountId = this.config.account || accounts[0];
    if (!accountId) throw new HttpError(503, 'No IB account is available');
    if (!accounts.includes(accountId)) throw new HttpError(503, 'Configured IB_ACCOUNT is not available');
    return this.getAccountSnapshot(accountId);
  }

  async getAccountSnapshot(accountId) {
    const accounts = await this.getManagedAccounts();
    if (!accounts.includes(accountId)) throw new HttpError(404, 'Account not found');
    const failures = [];
    const [summaryResult, positionsResult] = await Promise.allSettled([this._requestSummary(), this._requestPositions()]);
    if (summaryResult.status === 'fulfilled') this._cacheSummary(summaryResult.value);
    else failures.push(summaryResult.reason);
    if (positionsResult.status === 'fulfilled') this._cachePositions(positionsResult.value);
    else failures.push(positionsResult.reason);

    const summaryEntry = this.summaryCache.get(accountId);
    const positionEntry = this.positionsCache.get(accountId);
    if (!summaryEntry && !positionEntry) {
      throw new HttpError(503, failures.length ? errorText(failures[0]) : 'IB account snapshot unavailable');
    }
    const timestamps = [summaryEntry?.asOf, positionEntry?.asOf].filter(Number.isFinite);
    const asOfMs = timestamps.length ? Math.min(...timestamps) : this.now();
    const warnings = [];
    if (!summaryEntry || !positionEntry || this.now() - asOfMs > this.snapshotMaxAgeMs) warnings.push('Account snapshot is stale or incomplete.');
    if (failures.length) warnings.push('Snapshot refresh failed; showing available cached data.');

    const rows = summaryEntry?.rows || [];
    const positions = positionEntry?.positions || [];
    const unrealized = positions.map((position) => position.unrealizedPnl).filter(finite);
    const excludesNonStockPnl = Boolean(positionEntry?.excludedNonStock || positionEntry?.excludedNonUsd || summaryEntry?.excludedNonUsd);
    const summary = {
      netLiquidation: this._summaryValue(rows, 'NetLiquidation'),
      cash: this._summaryValue(rows, 'TotalCashValue'),
      buyingPower: this._summaryValue(rows, 'BuyingPower'),
      availableFunds: this._summaryValue(rows, 'AvailableFunds'),
      excessLiquidity: this._summaryValue(rows, 'ExcessLiquidity'),
      maintenanceMargin: this._summaryValue(rows, 'MaintMarginReq'),
      grossPositionValue: this._summaryValue(rows, 'GrossPositionValue'),
      unrealizedPnl: excludesNonStockPnl ? null : unrealized.length ? unrealized.reduce((sum, value) => sum + value, 0) : positionEntry ? 0 : null,
      realizedPnl: excludesNonStockPnl ? null : positionEntry?.realizedPnl ?? null,
    };
    const result = {
      accountId,
      asOf: new Date(asOfMs).toISOString(),
      currency: 'USD',
      summary,
      positions,
    };
    if (positionEntry?.excludedNonStock) warnings.push('Non-stock positions and P&L are excluded from this stock-only overview.');
    if (summaryEntry?.excludedNonUsd || positionEntry?.excludedNonUsd) warnings.push('Non-USD account totals or positions are excluded from this USD-only overview.');
    if (warnings.length) result.warnings = warnings;
    if (failures.length) result.error = errorText(failures[0]);
    return result;
  }

  _requestSummary() {
    if (!this.connected) return Promise.reject(new HttpError(503, 'IB Gateway/TWS is not connected'));
    if (this.summaryRequest) return this.summaryRequest;
    const requestId = ++this.nextRequestId;
    const rows = [];
    const request = new Promise((resolve, reject) => {
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearTimeout(timer);
        releaseListener(this.ib, EventName.accountSummary, onSummary);
        releaseListener(this.ib, EventName.accountSummaryEnd, onEnd);
        try { this.ib.cancelAccountSummary(requestId); } catch { /* Request may have failed before subscription. */ }
      };
      const onSummary = (id, account, tag, value, currency) => {
        if (id === requestId) rows.push({ account, tag, value, currency });
      };
      const onEnd = (id) => {
        if (id !== requestId) return;
        cleanup();
        resolve(rows);
      };
      const timer = waitTimer(() => {
        cleanup();
        reject(new HttpError(504, 'Timed out waiting for IB account summary'));
      }, this.requestTimeoutMs);
      this.ib.on(EventName.accountSummary, onSummary);
      this.ib.on(EventName.accountSummaryEnd, onEnd);
      try { this.ib.reqAccountSummary(requestId, 'All', SUMMARY_TAGS); } catch (error) {
        cleanup();
        reject(new HttpError(503, errorText(error)));
      }
    });
    this.summaryRequest = request;
    request.finally(() => { if (this.summaryRequest === request) this.summaryRequest = null; }).catch(() => {});
    return request;
  }

  _requestPositions() {
    if (!this.connected) return Promise.reject(new HttpError(503, 'IB Gateway/TWS is not connected'));
    if (this.positionRequest) return this.positionRequest;
    const request = (async () => {
      const rows = [];
      const excludedAccounts = new Set();
      const excludedNonUsdAccounts = new Set();
      for (const account of this.accounts) {
        if (!this.connected) throw new HttpError(503, 'IB Gateway/TWS disconnected during account snapshot');
        const accountRows = await new Promise((resolve, reject) => {
          const item = {
            account,
            rows: [],
            excludedNonStock: false,
            excludedNonUsd: false,
            finish: (error, value) => {
              if (this.portfolioRequest !== item) return;
              clearTimeout(item.timer);
              this.portfolioRequest = null;
              try { this.ib.reqAccountUpdates(false, account); } catch { /* Subscription already closed. */ }
              if (error) reject(error);
              else resolve({ rows: value, excludedNonStock: item.excludedNonStock, excludedNonUsd: item.excludedNonUsd });
            },
          };
          item.timer = waitTimer(() => item.finish(new HttpError(504, `Timed out waiting for IB portfolio: ${account}`)), this.requestTimeoutMs);
          this.portfolioRequest = item;
          try { this.ib.reqAccountUpdates(true, account); }
          catch (error) { item.finish(new HttpError(503, errorText(error))); }
        });
        rows.push(...accountRows.rows);
        if (accountRows.excludedNonStock) excludedAccounts.add(account);
        if (accountRows.excludedNonUsd) excludedNonUsdAccounts.add(account);
      }
      return { rows, excludedAccounts, excludedNonUsdAccounts };
    })();
    this.positionRequest = request;
    request.finally(() => { if (this.positionRequest === request) this.positionRequest = null; }).catch(() => {});
    return request;
  }

  _cacheSummary(rows) {
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.account)) grouped.set(row.account, []);
      grouped.get(row.account).push(row);
    }
    const asOf = this.now();
    const tags = SUMMARY_TAGS.split(',');
    for (const [account, values] of grouped) {
      const excludedNonUsd = values.some((row) => tags.includes(row.tag) && row.currency !== 'USD' && toNumber(row.value) !== null);
      this.summaryCache.set(account, { rows: values, excludedNonUsd, asOf });
    }
    for (const account of this.accounts) {
      if (!grouped.has(account)) this.summaryCache.set(account, { rows: [], excludedNonUsd: false, asOf });
    }
  }

  _cachePositions({ rows, excludedAccounts, excludedNonUsdAccounts }) {
    const grouped = new Map(this.accounts.map((account) => [account, []]));
    for (const row of rows) {
      if (!grouped.has(row.account)) grouped.set(row.account, []);
      if (!row.quantity) continue;
      grouped.get(row.account).push({
        symbol: row.symbol,
        quantity: row.quantity,
        averageCost: row.averageCost,
        price: row.marketPrice,
        marketValue: row.marketValue,
        unrealizedPnl: row.unrealizedPnl,
      });
    }
    const asOf = this.now();
    for (const [account, positions] of grouped) {
      const realized = rows.filter((row) => row.account === account).map((row) => row.realizedPnl).filter(finite);
      this.positionsCache.set(account, {
        positions,
        realizedPnl: realized.length ? realized.reduce((sum, value) => sum + value, 0) : positions.length ? null : 0,
        excludedNonStock: excludedAccounts.has(account),
        excludedNonUsd: excludedNonUsdAccounts.has(account),
        asOf,
      });
    }
  }

  _summaryValue(rows, tag) {
    const matching = rows.filter((row) => row.tag === tag);
    const row = matching.find((entry) => entry.currency === 'USD');
    return toNumber(row?.value);
  }

  _allocateOrderIds(count) {
    if (!this.ready || !Number.isInteger(this.nextOrderId)) throw new HttpError(503, 'IB Gateway/TWS handshake is not ready');
    const first = this.nextOrderId;
    this.nextOrderId += count;
    return Array.from({ length: count }, (_, index) => first + index);
  }

  async _serializeOrder(work) {
    let release;
    const previous = this.orderQueue;
    this.orderQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await work(); }
    finally { release(); }
  }

  async submitOrder(value) {
    const ticket = validateOrderTicket(value);
    return this._serializeOrder(async () => {
      if (!this.ready || !this.accounts.length) throw new HttpError(503, 'IB Gateway/TWS handshake is not ready');
      if (this.config.account && !this.accounts.includes(this.config.account)) {
        throw new HttpError(503, 'Configured IB_ACCOUNT is not available');
      }
      const childCount = Number(ticket.takeProfit !== undefined) + Number(ticket.stopLoss !== undefined);
      const ids = await this._allocateOrderIds(1 + childCount);
      const ref = `sap:${randomUUID()}`;
      const contract = new Stock(ticket.symbol, 'SMART', 'USD');
      const accountField = this.config.account ? { account: this.config.account } : {};
      const hasBracket = childCount > 0;
      const parent = {
        orderId: ids[0],
        action: ticket.side === 'BUY' ? OrderAction.BUY : OrderAction.SELL,
        totalQuantity: ticket.quantity,
        orderType: OrderType.LMT,
        lmtPrice: ticket.limitPrice,
        tif: ticket.tif,
        orderRef: `${ref}:entry`,
        transmit: !hasBracket,
        ...accountField,
      };
      const children = [];
      let idIndex = 1;
      const ocaGroup = childCount === 2 ? `sap-${randomUUID().replaceAll('-', '')}` : undefined;
      const exitAction = ticket.side === 'BUY' ? OrderAction.SELL : OrderAction.BUY;
      if (ticket.takeProfit !== undefined) {
        children.push({
          id: ids[idIndex++],
          role: 'takeProfit',
          order: {
            orderId: ids[idIndex - 1], action: exitAction, totalQuantity: ticket.quantity,
            orderType: OrderType.LMT, lmtPrice: ticket.takeProfit, tif: ticket.tif,
            orderRef: `${ref}:tp`, parentId: ids[0], transmit: !ticket.stopLoss,
            ...(ocaGroup ? { ocaGroup, ocaType: 1 } : {}), ...accountField,
          },
        });
      }
      if (ticket.stopLoss !== undefined) {
        children.push({
          id: ids[idIndex++],
          role: 'stopLoss',
          order: {
            orderId: ids[idIndex - 1], action: exitAction, totalQuantity: ticket.quantity,
            orderType: OrderType.STP, auxPrice: ticket.stopLoss, tif: ticket.tif,
            orderRef: `${ref}:sl`, parentId: ids[0], transmit: true,
            ...(ocaGroup ? { ocaGroup, ocaType: 1 } : {}), ...accountField,
          },
        });
      }
      const sent = [];
      try {
        this.ib.placeOrder(ids[0], contract, parent);
        sent.push(ids[0]);
        for (const child of children) {
          this.ib.placeOrder(child.id, contract, child.order);
          sent.push(child.id);
        }
      } catch (error) {
        for (const orderId of sent) {
          try { this.ib.cancelOrder(orderId); } catch { /* Best-effort cleanup of an untransmitted bracket. */ }
        }
        throw new HttpError(502, `IB order submission failed: ${errorText(error)}`);
      }
      const createdAt = new Date(this.now()).toISOString();
      const entry = this._storeSubmitted(ids[0], contract, parent, 'entry', createdAt);
      const orders = [entry];
      for (const child of children) orders.push(this._storeSubmitted(child.id, contract, child.order, child.role, createdAt));
      return orders;
    });
  }

  _storeSubmitted(orderId, contract, order, role, createdAt) {
    const item = { orderId, contract, order, status: 'PendingSubmit', filled: 0, remaining: order.totalQuantity, createdAt, role, clientId: this.config.clientId };
    const id = order.orderRef;
    this.ordersByRef.set(id, item);
    this.openOrderRefs.add(id);
    this.openOrderRefresh?.refs.add(id);
    return this._orderView(id, item);
  }

  _recordOpenOrder(orderId, contract, order, state) {
    if (!order || !contract) return;
    if (Number.isInteger(orderId) && orderId >= 0) {
      this.maxObservedOrderId = Math.max(this.maxObservedOrderId, orderId);
      if (this.nextOrderId !== null) this.nextOrderId = Math.max(this.nextOrderId, orderId + 1);
    }
    if (contract.secType !== 'STK' || contract.currency !== 'USD' || !['LMT', 'STP'].includes(order.orderType) || !contract.symbol) return;
    const stableRef = typeof order.orderRef === 'string'
      && order.orderRef.length > 0
      && order.orderRef.length <= 128
      && /^[A-Za-z0-9:._-]+$/.test(order.orderRef)
      ? order.orderRef
      : null;
    const permId = Number.isInteger(order.permId) && order.permId > 0 ? order.permId : null;
    const fallbackRef = `ib:${permId || `${order.clientId ?? 0}:${orderId}`}`;
    let ref = stableRef || fallbackRef;
    let previous = this.ordersByRef.get(ref);
    if (previous && (previous.orderId !== orderId || (order.clientId !== undefined && previous.clientId !== order.clientId))) {
      ref = fallbackRef;
      previous = this.ordersByRef.get(ref);
      if (previous && previous.orderId !== orderId) ref = `${fallbackRef}:${order.clientId ?? 0}:${orderId}`;
      previous = this.ordersByRef.get(ref);
    }
    const clientId = order.clientId ?? previous?.clientId;
    const status = this.orderStatusById.get(`${clientId}:${orderId}`);
    const normalizedOrder = { ...order, orderRef: ref };
    const item = {
      orderId,
      contract,
      order: normalizedOrder,
      clientId,
      status: status?.status || state?.status || previous?.status || 'Submitted',
      filled: status?.filled ?? previous?.filled ?? 0,
      remaining: status?.remaining ?? previous?.remaining ?? toNumber(order.totalQuantity),
      createdAt: previous?.createdAt,
      role: ref.endsWith(':tp') ? 'takeProfit' : ref.endsWith(':sl') ? 'stopLoss' : ref.endsWith(':entry') ? 'entry' : undefined,
    };
    this.ordersByRef.set(ref, item);
    if (this.openOrderRefresh) this.openOrderRefresh.refs.add(ref);
    else if (!this.ignoreLateOpenOrders) this.openOrderRefs.add(ref);
  }

  async listOrders() {
    if (!this.connected) throw new HttpError(503, 'IB Gateway/TWS is not connected');
    if (this.ignoreLateOpenOrders) throw new HttpError(503, 'Previous IB open-order snapshot is still incomplete');
    if (this.openOrdersRequest) {
      await this.openOrdersRequest;
      return this._orderViews();
    }
    const request = new Promise((resolve, reject) => {
      const refresh = { refs: new Set() };
      this.openOrderRefresh = refresh;
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        releaseListener(this.ib, EventName.openOrderEnd, onEnd);
        if (this.openOrderRefresh === refresh) this.openOrderRefresh = null;
      };
      const finish = (error) => {
        if (settled) return;
        cleanup();
        if (error) reject(error);
        else {
          this.openOrderRefs = refresh.refs;
          resolve();
        }
      };
      refresh.finish = finish;
      const onEnd = () => finish();
      const timer = waitTimer(() => {
        this.ignoreLateOpenOrders = true;
        finish(new HttpError(504, 'Timed out waiting for complete IB open-order snapshot'));
      }, this.requestTimeoutMs);
      this.ib.on(EventName.openOrderEnd, onEnd);
      try { this.ib.reqAllOpenOrders(); } catch (error) {
        finish(new HttpError(503, errorText(error)));
      }
    });
    this.openOrdersRequest = request;
    try { await request; }
    finally { if (this.openOrdersRequest === request) this.openOrdersRequest = null; }
    return this._orderViews();
  }

  _orderViews() {
    return [...this.openOrderRefs]
      .map((id) => [id, this.ordersByRef.get(id)])
      .filter(([, item]) => item && !TERMINAL.has(item.status))
      .map(([id, item]) => this._orderView(id, item));
  }

  _isManageable(id, item) {
    return item.contract.secType === 'STK'
      && ['LMT', 'STP'].includes(item.order.orderType)
      && /^sap:[0-9a-f-]{36}:(entry|tp|sl)$/i.test(id)
      && Number(item.clientId ?? item.order.clientId) === this.config.clientId
      && (!this.config.account || item.order.account === this.config.account);
  }

  _orderView(id, item) {
    const order = item.order;
    const parentRef = order.parentId
      ? [...this.ordersByRef.entries()].find(([, row]) => row.orderId === order.parentId && row.clientId === item.clientId)?.[0] || `ib:${order.parentId}`
      : undefined;
    const result = {
      id,
      symbol: item.contract.symbol,
      side: order.action,
      quantity: toNumber(order.totalQuantity),
      limitPrice: order.orderType === 'LMT' ? toNumber(order.lmtPrice) : null,
      type: order.orderType,
      tif: order.tif || 'DAY',
      status: item.status,
      manageable: this._isManageable(id, item),
    };
    if (order.orderType === 'STP') result.stopPrice = toNumber(order.auxPrice);
    if (parentRef) result.parentId = parentRef;
    if (item.role && item.role !== 'entry') result.bracketRole = item.role;
    if (item.filled !== undefined && item.filled !== null) result.filled = item.filled;
    if (item.createdAt) result.createdAt = item.createdAt;
    return result;
  }

  async modifyOrder(id, value) {
    const patch = validatePricePatch(value);
    return this._serializeOrder(async () => {
      if (!this.ready) throw new HttpError(503, 'IB Gateway/TWS handshake is not ready');
      await this.listOrders();
      const item = this.ordersByRef.get(id);
      if (!item || !this.openOrderRefs.has(id) || TERMINAL.has(item.status)) throw new HttpError(404, 'Pending order not found');
      if (!this._isManageable(id, item)) throw new HttpError(403, 'Order is read-only or unsupported');
      if (patch.limitPrice !== undefined && item.order.orderType !== 'LMT') throw new HttpError(400, 'Only limit orders accept limitPrice changes');
      if (patch.stopPrice !== undefined && item.order.orderType !== 'STP') throw new HttpError(400, 'Only stop orders accept stopPrice changes');
      const order = { ...item.order };
      if (patch.limitPrice !== undefined) order.lmtPrice = patch.limitPrice;
      if (patch.stopPrice !== undefined) order.auxPrice = patch.stopPrice;
      try { this.ib.placeOrder(item.orderId, item.contract, order); }
      catch (error) { throw new HttpError(502, `IB order modification failed: ${errorText(error)}`); }
      item.order = order;
      item.status = 'PendingSubmit';
      return { order: this._orderView(id, item) };
    });
  }

  async cancelOrder(id) {
    return this._serializeOrder(async () => {
      if (!this.ready) throw new HttpError(503, 'IB Gateway/TWS handshake is not ready');
      await this.listOrders();
      const item = this.ordersByRef.get(id);
      if (!item || !this.openOrderRefs.has(id) || TERMINAL.has(item.status)) throw new HttpError(404, 'Pending order not found');
      if (!this._isManageable(id, item)) throw new HttpError(403, 'Order is read-only or unsupported');
      try { this.ib.cancelOrder(item.orderId); }
      catch (error) { throw new HttpError(502, `IB order cancellation failed: ${errorText(error)}`); }
      item.status = 'PendingCancel';
      return { order: this._orderView(id, item) };
    });
  }
}
