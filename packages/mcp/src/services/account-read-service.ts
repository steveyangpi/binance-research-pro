import { z } from 'zod';
import type { AccountApiClient } from '../account/account-api-client.js';
import type { AccountProfileStore } from '../account/account-profile-store.js';

const numericString = z
  .string()
  .max(128)
  .regex(/^-?\d+(?:\.\d+)?$/);
const integerIdentifier = z.union([
  z.number().int().safe(),
  z
    .string()
    .max(128)
    .regex(/^-?\d+$/),
]);
const tradeIdentifier = z.union([integerIdentifier, z.literal('')]).optional();

function decimalParts(value: string): { units: bigint; scale: number } {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer = '0', fraction = ''] = unsigned.split('.');
  const units = BigInt(`${integer}${fraction}`);
  return { units: negative ? -units : units, scale: fraction.length };
}

function formatDecimal(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${negative ? '-' : ''}${digits}`;
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale);
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

function addDecimals(left: string, right: string): string {
  const first = decimalParts(left);
  const second = decimalParts(right);
  const scale = Math.max(first.scale, second.scale);
  const firstUnits = first.units * 10n ** BigInt(scale - first.scale);
  const secondUnits = second.units * 10n ** BigInt(scale - second.scale);
  return formatDecimal(firstUnits + secondUnits, scale);
}

function isZeroDecimal(value: string): boolean {
  return decimalParts(value).units === 0n;
}

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
    orderId: integerIdentifier,
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
    tranId: integerIdentifier,
    tradeId: tradeIdentifier,
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
        free: balance.free,
        locked: balance.locked,
        total: addDecimals(balance.free, balance.locked),
      }))
      .filter((balance) => includeZeroBalances || !isZeroDecimal(balance.total));
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
        positionAmount: position.positionAmt,
        entryPrice: position.entryPrice,
        breakEvenPrice: position.breakEvenPrice ?? null,
        markPrice: position.markPrice,
        unrealizedProfit: position.unRealizedProfit,
        liquidationPrice: position.liquidationPrice,
        leverage: position.leverage,
        marginType: position.marginType,
        isolatedMargin: position.isolatedMargin,
        notional: position.notional ?? null,
        updateTime: position.updateTime,
      }));
    return {
      profileId: response.profileId,
      positions: positions.filter(
        (position) => includeFlat || !isZeroDecimal(position.positionAmount),
      ),
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
        orderId: String(order.orderId),
        clientOrderId: order.clientOrderId,
        side: order.side,
        positionSide: order.positionSide,
        type: order.type,
        status: order.status,
        timeInForce: order.timeInForce,
        price: order.price,
        originalQuantity: order.origQty,
        executedQuantity: order.executedQty,
        stopPrice: order.stopPrice,
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
        income: entry.income,
        asset: entry.asset,
        info: entry.info,
        time: entry.time,
        transactionId: String(entry.tranId),
        tradeId: entry.tradeId === undefined || entry.tradeId === '' ? null : String(entry.tradeId),
      }));
    return { profileId: response.profileId, entries };
  }
}
