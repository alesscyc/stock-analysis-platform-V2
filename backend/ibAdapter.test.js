import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EventName } from '@stoqey/ib';
import { IbAdapter } from './ibAdapter.js';

class FakeIb extends EventEmitter {
  constructor({ deferHandshake = false } = {}) {
    super();
    this.deferHandshake = deferHandshake;
    this.isConnected = false;
    this.placed = [];
    this.cancelled = [];
    this.orders = new Map();
    this.accountSubscriptions = [];
    this.summaryRequests = 0;
    this.summaryCancellations = [];
    this.suppressSummaryEnd = false;
    this.suppressOpenOrderEnd = false;
    this.foreignSummary = false;
    this.foreignPosition = false;
  }

  connect(clientId) {
    this.clientId = clientId;
    this.isConnected = true;
    this.emit(EventName.connected);
  }

  disconnect() {
    this.isConnected = false;
    this.emit(EventName.disconnected);
  }

  reqManagedAccts() {
    if (!this.deferHandshake) this.emit(EventName.managedAccounts, 'DU100001,DU200002');
  }

  reqIds() {
    if (!this.deferHandshake) this.emit(EventName.nextValidId, 700);
  }

  reqAccountSummary(requestId) {
    this.summaryRequests++;
    for (const account of ['DU100001', 'DU200002']) {
      const offset = account === 'DU100001' ? 100000 : 200000;
      for (const [tag, value] of [
        ['NetLiquidation', offset], ['TotalCashValue', 50000], ['BuyingPower', 100000],
        ['AvailableFunds', 40000], ['ExcessLiquidity', 35000], ['MaintMarginReq', 5000], ['GrossPositionValue', 50000],
      ]) {
        if (this.foreignSummary && account === 'DU200002' && tag === 'GrossPositionValue') {
          this.emit(EventName.accountSummary, requestId, account, tag, '70000', 'EUR');
        } else {
          this.emit(EventName.accountSummary, requestId, account, tag, String(value), 'USD');
          if (this.foreignSummary && account === 'DU200002' && tag === 'NetLiquidation') {
            this.emit(EventName.accountSummary, requestId, account, tag, '999999', 'EUR');
          }
        }
      }
    }
    if (!this.suppressSummaryEnd) this.emit(EventName.accountSummaryEnd, requestId);
  }

  cancelAccountSummary(requestId) { this.summaryCancellations.push(requestId); }

  reqAccountUpdates(subscribe, account) {
    this.accountSubscriptions.push([subscribe, account]);
    if (!subscribe) return;
    if (account === 'DU200002') {
      this.emit(EventName.updatePortfolio, { symbol: 'AAPL', secType: 'OPT', currency: 'USD' }, 1, 2, 200, 1, 100, 50, account);
      if (this.foreignPosition) this.emit(EventName.updatePortfolio, { symbol: 'BABA', secType: 'STK', currency: 'HKD' }, 2, 70, 140, 65, 10, 5, account);
      this.emit(EventName.updatePortfolio, { symbol: 'AAPL', secType: 'STK', currency: 'USD' }, 3, 101, 303, 95, 18, 4, account);
    }
    this.emit(EventName.accountDownloadEnd, account);
  }

  reqAllOpenOrders() {
    for (const [orderId, item] of this.orders) {
      this.emit(EventName.openOrder, orderId, item.contract, item.order, { status: item.status });
    }
    if (!this.suppressOpenOrderEnd) this.emit(EventName.openOrderEnd);
  }

  placeOrder(orderId, contract, order) {
    this.placed.push({ orderId, contract, order: { ...order } });
    this.orders.set(orderId, { contract, order: { ...order }, status: 'Submitted' });
  }

  cancelOrder(orderId) { this.cancelled.push(orderId); }
}

function setup(config = {}, fakeOptions = {}) {
  const fake = new FakeIb(fakeOptions);
  const adapter = new IbAdapter({
    config: { account: 'DU200002', clientId: 29, ...config },
    ibApiFactory: () => fake,
    requestTimeoutMs: 100,
    snapshotMaxAgeMs: 10000,
  });
  adapter.start();
  return { adapter, fake };
}

const ticket = (patch = {}) => ({ symbol: 'AAPL', side: 'BUY', quantity: 1, limitPrice: 100, tif: 'DAY', ...patch });

test('IB display snapshots are stock-only, fresh, multi-account, and never choose order route', async () => {
  const { adapter, fake } = setup();
  try {
    assert.deepEqual(adapter.status(), { connected: true });
    assert.equal(fake.clientId, 29);
    assert.deepEqual(await adapter.getManagedAccounts(), ['DU100001', 'DU200002']);

    const first = await adapter.getAccountSnapshot('DU100001');
    assert.equal(first.accountId, 'DU100001');
    assert.equal(first.currency, 'USD');
    assert.equal(first.summary.netLiquidation, 100000);
    assert.equal(first.summary.cash, 50000);
    assert.deepEqual(first.positions, []);

    const defaults = await adapter.getDefaultAccountSnapshot();
    assert.equal(defaults.accountId, 'DU200002');
    assert.deepEqual(defaults.positions, [{
      symbol: 'AAPL', quantity: 3, averageCost: 95, price: 101, marketValue: 303, unrealizedPnl: 18,
    }]);
    assert.equal(defaults.summary.unrealizedPnl, null);
    assert.equal(defaults.summary.realizedPnl, null);
    assert.equal(defaults.summary.netLiquidation, 200000);
    assert.deepEqual(defaults.warnings, ['Non-stock positions and P&L are excluded from this stock-only overview.']);
    assert.ok(defaults.asOf);
    assert.deepEqual(fake.accountSubscriptions.filter(([subscribe]) => subscribe).map(([, account]) => account), [
      'DU100001', 'DU200002', 'DU100001', 'DU200002',
    ]);
    assert.ok(fake.summaryCancellations.length >= 1);
  } finally { adapter.stop(); }
});

test('IB USD report preserves USD rows, rejects non-USD values, and warns', async () => {
  const { adapter, fake } = setup();
  fake.foreignSummary = true;
  fake.foreignPosition = true;
  try {
    const snapshot = await adapter.getAccountSnapshot('DU200002');
    assert.equal(snapshot.currency, 'USD');
    assert.equal(snapshot.summary.netLiquidation, 200000);
    assert.equal(snapshot.summary.grossPositionValue, null);
    assert.deepEqual(snapshot.positions.map((position) => position.symbol), ['AAPL']);
    assert.equal(snapshot.summary.unrealizedPnl, null);
    assert.equal(snapshot.summary.realizedPnl, null);
    assert.ok(snapshot.warnings.includes('Non-USD account totals or positions are excluded from this USD-only overview.'));
  } finally { adapter.stop(); }
});

test('account-summary requests coalesce and cancel on completion and timeout', async () => {
  const { adapter, fake } = setup();
  try {
    await Promise.all([
      adapter.getAccountSnapshot('DU100001'),
      adapter.getAccountSnapshot('DU200002'),
    ]);
    assert.equal(fake.summaryRequests, 1);
    assert.equal(fake.summaryCancellations.length, 1);

    fake.suppressSummaryEnd = true;
    await assert.rejects(adapter._requestSummary(), /Timed out waiting for IB account summary/);
    assert.equal(fake.summaryRequests, 2);
    assert.equal(fake.summaryCancellations.length, 2);
  } finally { adapter.stop(); }
});

test('IB brackets use stable refs, safe transmit sequence, OCA, and configured routing', async () => {
  const { adapter, fake } = setup();
  try {
    const orders = await adapter.submitOrder({
      symbol: 'aapl', side: 'BUY', quantity: 3, limitPrice: 100, tif: 'GTC', takeProfit: 110, stopLoss: 90,
    });
    assert.equal(orders.length, 3);
    assert.ok(orders.every((order) => order.manageable));
    assert.equal(new Set(orders.map((order) => order.id)).size, 3);
    assert.deepEqual(fake.placed.map(({ order }) => order.transmit), [false, false, true]);
    const [parent, takeProfit, stopLoss] = fake.placed.map((item) => item.order);
    assert.match(parent.orderRef, /^sap:[0-9a-f-]+:entry$/);
    assert.match(takeProfit.orderRef, /^sap:[0-9a-f-]+:tp$/);
    assert.match(stopLoss.orderRef, /^sap:[0-9a-f-]+:sl$/);
    assert.equal(takeProfit.parentId, parent.orderId);
    assert.equal(stopLoss.parentId, parent.orderId);
    assert.equal(takeProfit.ocaGroup, stopLoss.ocaGroup);
    assert.equal(takeProfit.ocaType, 1);
    assert.equal(stopLoss.ocaType, 1);
    assert.ok(fake.placed.every(({ order }) => order.account === 'DU200002'));
    assert.deepEqual(orders.map((order) => order.bracketRole), [undefined, 'takeProfit', 'stopLoss']);

    const openOrders = await adapter.listOrders();
    assert.deepEqual(openOrders.map((order) => order.id), orders.map((order) => order.id));
    assert.equal(openOrders[2].parentId, orders[0].id);
    assert.equal(openOrders[2].stopPrice, 90);

    const modified = await adapter.modifyOrder(orders[2].id, { stopPrice: 91 });
    assert.equal(modified.order.stopPrice, 91);
    assert.equal(fake.placed.at(-1).order.totalQuantity, 3);
    assert.equal(fake.placed.at(-1).order.auxPrice, 91);
    const cancelled = await adapter.cancelOrder(orders[0].id);
    assert.equal(cancelled.order.status, 'PendingCancel');
    assert.deepEqual(fake.cancelled, [parent.orderId]);
  } finally { adapter.stop(); }
});

test('IB validates whole-share/bracket prices and transmits unbracketed order', async () => {
  const { adapter, fake } = setup();
  try {
    await assert.rejects(adapter.submitOrder(ticket({ quantity: 1.5 })), /quantity is invalid/);
    await assert.rejects(adapter.submitOrder(ticket({ stopLoss: 105 })), /stopLoss must be beyond entry price/);
    assert.equal(fake.placed.length, 0);

    const [order] = await adapter.submitOrder({ ...ticket(), side: 'SELL', tif: 'IOC' });
    assert.equal(fake.placed[0].order.transmit, true);
    assert.equal(fake.placed[0].order.account, 'DU200002');
    assert.equal(fake.placed[0].order.action, 'SELL');
    assert.equal(order.status, 'PendingSubmit');
  } finally { adapter.stop(); }
});

test('order snapshots preserve refs on timeout, separate empty refs, filter assets, and mark foreign stocks read-only', async () => {
  const { adapter, fake } = setup();
  try {
    const [own] = await adapter.submitOrder(ticket());
    const initial = await adapter.listOrders();
    assert.equal(initial[0].manageable, true);
    const cachedRefs = [...adapter.openOrderRefs];
    fake.orders.set(850, {
      contract: { symbol: 'MSFT', secType: 'STK', currency: 'USD' },
      order: { orderRef: '', permId: 60001, clientId: 88, orderType: 'LMT', action: 'BUY', totalQuantity: 1, lmtPrice: 10, tif: 'DAY' },
      status: 'Submitted',
    });
    fake.orders.set(851, {
      contract: { symbol: 'NVDA', secType: 'STK', currency: 'USD' },
      order: { orderRef: '', permId: 60002, clientId: 89, orderType: 'LMT', action: 'BUY', totalQuantity: 1, lmtPrice: 20, tif: 'DAY' },
      status: 'Submitted',
    });
    fake.orders.set(900, {
      contract: { symbol: 'AAPL', secType: 'OPT', currency: 'USD' },
      order: { orderRef: '', permId: 60003, clientId: 88, orderType: 'LMT', action: 'BUY', totalQuantity: 1, lmtPrice: 2, tif: 'DAY' },
      status: 'Submitted',
    });
    fake.orders.set(899, {
      contract: { symbol: 'SAP', secType: 'STK', currency: 'EUR' },
      order: { orderRef: '', permId: 60004, clientId: 88, orderType: 'LMT', action: 'BUY', totalQuantity: 1, lmtPrice: 200, tif: 'DAY' },
      status: 'Submitted',
    });
    fake.suppressOpenOrderEnd = true;
    await assert.rejects(adapter.listOrders(), /complete IB open-order snapshot/);
    assert.deepEqual([...adapter.openOrderRefs], cachedRefs);
    assert.ok(adapter.ordersByRef.has('ib:60001'));
    assert.ok(adapter.ordersByRef.has('ib:60002'));
    assert.equal(adapter.ordersByRef.has(''), false);
    await assert.rejects(adapter.listOrders(), /still incomplete/);

    fake.emit(EventName.openOrderEnd);
    fake.suppressOpenOrderEnd = false;
    const refreshed = await adapter.listOrders();
    assert.deepEqual(new Set(refreshed.map((order) => order.id)), new Set([own.id, 'ib:60001', 'ib:60002']));
    assert.equal(refreshed.find((order) => order.id === 'ib:60001').manageable, false);
    assert.equal(refreshed.find((order) => order.id === own.id).manageable, true);
    assert.equal(refreshed.some((order) => order.symbol === 'AAPL' && order.id === 'ib:60003'), false);
    await assert.rejects(adapter.modifyOrder('ib:60001', { limitPrice: 11 }), /read-only/);

    const [next] = await adapter.submitOrder(ticket());
    assert.equal(fake.placed.at(-1).orderId, 901);
    assert.equal(next.manageable, true);
  } finally { adapter.stop(); }
});

test('same numeric IDs and references from other IB clients cannot change our order state', async () => {
  const { adapter, fake } = setup();
  try {
    const [own] = await adapter.submitOrder(ticket());
    await adapter.listOrders();
    const contract = { symbol: 'MSFT', secType: 'STK', currency: 'USD' };
    const foreign = { orderRef: own.id, permId: 9876, clientId: 88, account: 'DU200002', orderType: 'LMT', action: 'BUY', totalQuantity: 2, lmtPrice: 100, tif: 'DAY' };
    fake.emit(EventName.openOrder, 700, contract, foreign, { status: 'Submitted' });
    assert.equal(adapter.ordersByRef.get(own.id).clientId, 29);
    assert.equal(adapter.ordersByRef.get('ib:9876').clientId, 88);

    fake.emit(EventName.orderStatus, 700, 'Filled', 2, 0, 100, 9876, 0, 100, 88);
    assert.equal(adapter.ordersByRef.get(own.id).status, 'Submitted');
    assert.equal(adapter.ordersByRef.get('ib:9876').status, 'Filled');
    assert.ok(adapter.openOrderRefs.has(own.id));
    assert.equal((await adapter.listOrders())[0].status, 'Submitted');
    await adapter.modifyOrder(own.id, { limitPrice: 101 });
    assert.equal(fake.placed.at(-1).orderId, 700);

    fake.emit(EventName.openOrder, 701, contract, { ...foreign, orderRef: 'foreign-child', permId: 9877, parentId: 700 }, { status: 'Submitted' });
    const child = adapter._orderViews().find((order) => order.id === 'foreign-child');
    assert.equal(child.parentId, 'ib:9876');
    assert.equal(child.manageable, false);
  } finally { adapter.stop(); }
});

test('modify/cancel refresh broker snapshot and refuse stale refs dropped as filled', async () => {
  const { adapter, fake } = setup();
  try {
    const [order] = await adapter.submitOrder(ticket());
    await adapter.listOrders();
    assert.ok(adapter.ordersByRef.has(order.id));
    fake.orders.clear();
    assert.deepEqual(await adapter.listOrders(), []);
    const placedCount = fake.placed.length;
    await assert.rejects(adapter.modifyOrder(order.id, { limitPrice: 101 }), /Pending order not found/);
    await assert.rejects(adapter.cancelOrder(order.id), /Pending order not found/);
    assert.equal(fake.placed.length, placedCount);
    assert.deepEqual(fake.cancelled, []);
  } finally { adapter.stop(); }
});

test('reconnect clears order state and blocks routing until new account and ID handshake', async () => {
  const { adapter, fake } = setup({}, { deferHandshake: true });
  try {
    assert.equal(adapter.status().connected, true);
    await assert.rejects(adapter.submitOrder(ticket()), /handshake is not ready/);
    fake.emit(EventName.managedAccounts, 'DU100001,DU200002');
    assert.equal(adapter.ready, false);
    fake.emit(EventName.nextValidId, 700);
    assert.equal(adapter.ready, true);

    const [oldOrder] = await adapter.submitOrder(ticket());
    await adapter.listOrders();
    fake.emit(EventName.orderStatus, 700, 'Filled', 1, 0, 100);
    assert.equal(adapter.ordersByRef.get(oldOrder.id).status, 'Filled');
    fake.isConnected = false;
    fake.emit(EventName.disconnected);
    assert.equal(adapter.ordersByRef.size, 0);
    assert.equal(adapter.orderStatusById.size, 0);
    assert.equal(adapter.openOrderRefs.size, 0);
    await assert.rejects(adapter.submitOrder(ticket()), /handshake is not ready/);

    fake.deferHandshake = false;
    fake.connect(29);
    assert.equal(adapter.ready, true);
    fake.orders.set(700, {
      contract: { symbol: 'MSFT', secType: 'STK', currency: 'USD' },
      order: { orderRef: 'sap:11111111-1111-4111-8111-111111111111:entry', clientId: 29, account: 'DU200002', orderType: 'LMT', action: 'BUY', totalQuantity: 1, lmtPrice: 10, tif: 'DAY' },
      status: 'Submitted',
    });
    const orders = await adapter.listOrders();
    assert.equal(orders[0].status, 'Submitted');
    assert.equal(orders[0].manageable, true);
    assert.equal(orders[0].id, 'sap:11111111-1111-4111-8111-111111111111:entry');
  } finally { adapter.stop(); }
});
