import { describe, expect, it, vi } from 'vitest';
import type { AccountApiClient } from '../src/account/account-api-client.js';
import type { AccountProfileStore } from '../src/account/account-profile-store.js';
import { AccountReadService } from '../src/services/account-read-service.js';

function serviceFor(data: unknown) {
  const client = {
    get: vi.fn().mockResolvedValue({ profileId: 'readonly', data }),
  } as unknown as AccountApiClient;
  const profiles = {} as AccountProfileStore;
  return { client, service: new AccountReadService(profiles, client) };
}

describe('AccountReadService', () => {
  it('preserves exact Spot decimal strings and computes totals without floating-point loss', async () => {
    const fixture = serviceFor({
      accountType: 'SPOT',
      updateTime: 1_750_000_000_000,
      balances: [
        {
          asset: 'BTC',
          free: '123456789012345.12345678',
          locked: '0.00000002',
        },
        { asset: 'ETH', free: '0.00000000', locked: '0.00000000' },
      ],
    });

    await expect(fixture.service.spotAccountOverview('readonly')).resolves.toEqual({
      profileId: 'readonly',
      accountType: 'SPOT',
      updateTime: 1_750_000_000_000,
      balances: [
        {
          asset: 'BTC',
          free: '123456789012345.12345678',
          locked: '0.00000002',
          total: '123456789012345.12345680',
        },
      ],
    });
  });

  it('preserves exact Futures position decimals and filters only exact zero positions', async () => {
    const fixture = serviceFor([
      {
        symbol: 'BTCUSDT',
        positionAmt: '0.00000000',
        entryPrice: '0.00000000',
        breakEvenPrice: '0.00000000',
        markPrice: '60000.12345678',
        unRealizedProfit: '0.00000000',
        liquidationPrice: '0.00000000',
        leverage: '10',
        marginType: 'cross',
        isolatedMargin: '0.00000000',
        notional: '0.00000000',
        positionSide: 'BOTH',
        updateTime: 1_750_000_000_000,
      },
      {
        symbol: 'ETHUSDT',
        positionAmt: '-0.123456789012345678',
        entryPrice: '3123.12345678',
        markPrice: '3000.87654321',
        unRealizedProfit: '15.123456789012345678',
        liquidationPrice: '4000.00000000',
        leverage: '20',
        marginType: 'isolated',
        isolatedMargin: '50.12345678',
        positionSide: 'SHORT',
        updateTime: 1_750_000_000_001,
      },
    ]);

    const result = await fixture.service.futuresPositions('readonly');
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({
      symbol: 'ETHUSDT',
      positionAmount: '-0.123456789012345678',
      entryPrice: '3123.12345678',
      unrealizedProfit: '15.123456789012345678',
    });
  });

  it('returns order and income identifiers as lossless strings', async () => {
    const orderFixture = serviceFor([
      {
        symbol: 'BTCUSDT',
        orderId: '9007199254740993',
        clientOrderId: 'readonly-order',
        price: '60000.12345678',
        origQty: '0.00000001',
        executedQty: '0.00000000',
        status: 'NEW',
        timeInForce: 'GTC',
        type: 'LIMIT',
        side: 'BUY',
        positionSide: 'BOTH',
        reduceOnly: false,
        closePosition: false,
        stopPrice: '0.00000000',
        time: 1_750_000_000_000,
        updateTime: 1_750_000_000_000,
      },
    ]);
    const orders = await orderFixture.service.futuresOpenOrders('readonly');
    expect(orders.orders[0]).toMatchObject({
      orderId: '9007199254740993',
      price: '60000.12345678',
      originalQuantity: '0.00000001',
    });

    const incomeFixture = serviceFor([
      {
        symbol: 'BTCUSDT',
        incomeType: 'REALIZED_PNL',
        income: '123456789012345.12345678',
        asset: 'USDT',
        info: '',
        time: 1_750_000_000_000,
        tranId: '9007199254740993',
        tradeId: '9007199254740995',
      },
      {
        symbol: '',
        incomeType: 'TRANSFER',
        income: '-0.37500000',
        asset: 'USDT',
        info: 'TRANSFER',
        time: 1_750_000_000_001,
        tranId: '9007199254740994',
        tradeId: '',
      },
    ]);
    const income = await incomeFixture.service.futuresIncomeHistory({
      profileId: 'readonly',
      limit: 100,
    });
    expect(income.entries[0]).toMatchObject({
      income: '123456789012345.12345678',
      transactionId: '9007199254740993',
      tradeId: '9007199254740995',
    });
    expect(income.entries[1]).toMatchObject({
      incomeType: 'TRANSFER',
      transactionId: '9007199254740994',
      tradeId: null,
    });
  });
});
