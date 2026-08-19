import { z } from 'zod';
import type { AccountApiClient } from '../account/account-api-client.js';
import type { AccountProfileStore } from '../account/account-profile-store.js';

const numericString = z.string().refine((value) => Number.isFinite(Number(value)));

const spotAccountSchema = z
  .object({
    accountType: z.string().optional(),
    updateTime: z.number().optional(),
    balances: z.array(
      z.object({
        asset: z.string(),
        free: numericString,
        locked: numericString,
      }),
    ),
  })
  .passthrough();

const futuresPositionSchema = z
  .object({
    symbol: z.string(),
    positionAmt: numericString,
    entryPrice: numericString,
    breakEvenPrice: numericString.optional(),
    markPrice: numericString,
    unRealizedProfit: numericString,
    liquidationPrice: numericString,
    leverage: numericString,
    marginType: z.string(),
    isolatedMargin: numericString,
    notional: numericString.optional(),
    positionSide: z.string(),
    updateTime: z.number(),
  })
  .passthrough();

const futuresOrderSchema = z
  .object({
    symbol: z.string(),
    orderId: z.number(),
    clientOrderId: z.string(),
    price: numericString,
    origQty: numericString,
    executedQty: numericString,
    status: z.string(),
    timeInForce: z.string(),
    type: z.string(),
    side: z.string(),
    positionSide: z.string(),
    reduceOnly: z.boolean(),
    closePosition: z.boolean(),
    stopPrice: numericString,
    time: z.number(),
    updateTime: z.number(),
  })
  .passthrough();

const futuresIncomeSchema = z
  .object({
    symbol: z.string(),
    incomeType: z.string(),
    income: numericString,
    asset: z.string(),
    info: z.string(),
    time: z.number(),
    tranId: z.union([z.number(), z.string()]),
    tradeId: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export class AccountReadService {
  public constructor(
    private readonly profiles: AccountProfileStore,
    private readonly client: AccountApiClient,
  ) {}

  public profilesStatus() {
    return this.profiles.status();
  }

  public async spotAccountOverview(profileId?: string, includeZeroBalances = false) {
    const response = await this.client.get<unknown>('spot', profileId, '/api/v3/account');
    const account = spotAccountSchema.parse(response.data);
    const balances = account.balances
      .map((balance) => ({
        asset: balance.asset,
        free: Number(balance.free),
        locked: Number(balance.locked),
        total: Number(balance.free) + Number(balance.locked),
      }))
      .filter((balance) => includeZeroBalances || balance.total !== 0);
    return {
      profileId: response.profileId,
      accountType: account.accountType ?? null,
      updateTime: account.updateTime ?? null,
      balances,
    };
  }

  public async futuresPositions(profileId?: string, symbol?: string, includeFlat = false) {
    const response = await this.client.get<unknown>(
      'usd-m-futures',
      profileId,
      '/fapi/v3/positionRisk',
      { symbol },
    );
    const positions = z
      .array(futuresPositionSchema)
      .parse(response.data)
      .map((position) => ({
        symbol: position.symbol,
        positionSide: position.positionSide,
        positionAmount: Number(position.positionAmt),
        entryPrice: Number(position.entryPrice),
        breakEvenPrice:
          position.breakEvenPrice === undefined ? null : Number(position.breakEvenPrice),
        markPrice: Number(position.markPrice),
        unrealizedProfit: Number(position.unRealizedProfit),
        liquidationPrice: Number(position.liquidationPrice),
        leverage: Number(position.leverage),
        marginType: position.marginType,
        isolatedMargin: Number(position.isolatedMargin),
        notional: position.notional === undefined ? null : Number(position.notional),
        updateTime: position.updateTime,
      }));
    return {
      profileId: response.profileId,
      positions: positions.filter((position) => includeFlat || position.positionAmount !== 0),
    };
  }

  public async futuresOpenOrders(profileId?: string, symbol?: string) {
    const response = await this.client.get<unknown>(
      'usd-m-futures',
      profileId,
      '/fapi/v1/openOrders',
      { symbol },
    );
    const orders = z
      .array(futuresOrderSchema)
      .parse(response.data)
      .map((order) => ({
        symbol: order.symbol,
        orderId: order.orderId,
        clientOrderId: order.clientOrderId,
        side: order.side,
        positionSide: order.positionSide,
        type: order.type,
        status: order.status,
        timeInForce: order.timeInForce,
        price: Number(order.price),
        originalQuantity: Number(order.origQty),
        executedQuantity: Number(order.executedQty),
        stopPrice: Number(order.stopPrice),
        reduceOnly: order.reduceOnly,
        closePosition: order.closePosition,
        time: order.time,
        updateTime: order.updateTime,
      }));
    return { profileId: response.profileId, orders };
  }

  public async futuresIncomeHistory(options: {
    profileId?: string;
    symbol?: string;
    incomeType?: string;
    startTime?: number;
    endTime?: number;
    limit: number;
  }) {
    if (
      options.startTime !== undefined &&
      options.endTime !== undefined &&
      options.startTime > options.endTime
    ) {
      throw new Error('startTime must not be later than endTime.');
    }
    const response = await this.client.get<unknown>(
      'usd-m-futures',
      options.profileId,
      '/fapi/v1/income',
      {
        symbol: options.symbol,
        incomeType: options.incomeType,
        startTime: options.startTime,
        endTime: options.endTime,
        limit: options.limit,
      },
    );
    const entries = z
      .array(futuresIncomeSchema)
      .parse(response.data)
      .map((entry) => ({
        symbol: entry.symbol,
        incomeType: entry.incomeType,
        income: Number(entry.income),
        asset: entry.asset,
        info: entry.info,
        time: entry.time,
        transactionId: String(entry.tranId),
        tradeId: entry.tradeId === undefined ? null : String(entry.tradeId),
      }));
    return { profileId: response.profileId, entries };
  }
}
