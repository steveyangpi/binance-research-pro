import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AccountReadService } from '../services/account-read-service.js';
import { jsonOutputSchema, jsonResult, toolError } from './formatters.js';
import { symbolSchema } from './schemas.js';

const profileIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/);

const localPrivateConfigAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const privateNetworkReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerAccountTools(server: McpServer, service: AccountReadService): void {
  server.registerTool(
    'account_profiles_status',
    {
      title: 'Check account research profiles',
      description:
        'Show whether protected read-only Binance account profiles are configured and list only their IDs, key types, declared surfaces, and USER_DATA permissions. No credential values or paths are returned.',
      inputSchema: {},
      outputSchema: jsonOutputSchema,
      annotations: localPrivateConfigAnnotations,
    },
    async () => {
      try {
        return jsonResult(await service.profilesStatus());
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'spot_account_overview',
    {
      title: 'Read Spot account balances',
      description:
        'Read normalized Binance Spot balances through a configured Ed25519 USER_DATA profile. This tool cannot place or cancel orders.',
      inputSchema: {
        profileId: profileIdSchema.optional(),
        includeZeroBalances: z.boolean().default(false),
      },
      outputSchema: jsonOutputSchema,
      annotations: privateNetworkReadAnnotations,
    },
    async ({ profileId, includeZeroBalances }) => {
      try {
        return jsonResult(await service.spotAccountOverview(profileId, includeZeroBalances));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'futures_positions',
    {
      title: 'Read USD-M Futures positions',
      description:
        'Read normalized Binance USD-M position risk through a configured Ed25519 USER_DATA profile. This tool cannot change leverage or positions.',
      inputSchema: {
        profileId: profileIdSchema.optional(),
        symbol: symbolSchema.optional(),
        includeFlat: z.boolean().default(false),
      },
      outputSchema: jsonOutputSchema,
      annotations: privateNetworkReadAnnotations,
    },
    async ({ profileId, symbol, includeFlat }) => {
      try {
        return jsonResult(await service.futuresPositions(profileId, symbol, includeFlat));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'futures_open_orders',
    {
      title: 'Read USD-M Futures open orders',
      description:
        'Read current Binance USD-M open orders through a configured Ed25519 USER_DATA profile. This tool cannot create, modify, or cancel orders.',
      inputSchema: {
        profileId: profileIdSchema.optional(),
        symbol: symbolSchema.optional(),
      },
      outputSchema: jsonOutputSchema,
      annotations: privateNetworkReadAnnotations,
    },
    async ({ profileId, symbol }) => {
      try {
        return jsonResult(await service.futuresOpenOrders(profileId, symbol));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'futures_income_history',
    {
      title: 'Read USD-M Futures income history',
      description:
        'Read Binance USD-M realized PnL, funding, commission, and other income records through a configured Ed25519 USER_DATA profile.',
      inputSchema: {
        profileId: profileIdSchema.optional(),
        symbol: symbolSchema.optional(),
        incomeType: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
          .optional(),
        startTime: z.number().int().nonnegative().optional(),
        endTime: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(1000).default(100),
      },
      outputSchema: jsonOutputSchema,
      annotations: privateNetworkReadAnnotations,
    },
    async ({ profileId, symbol, incomeType, startTime, endTime, limit }) => {
      try {
        return jsonResult(
          await service.futuresIncomeHistory({
            ...(profileId === undefined ? {} : { profileId }),
            ...(symbol === undefined ? {} : { symbol }),
            ...(incomeType === undefined ? {} : { incomeType }),
            ...(startTime === undefined ? {} : { startTime }),
            ...(endTime === undefined ? {} : { endTime }),
            limit,
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
