import type { Pool } from "pg";
import type { BrokerOrderResult, OrderPayload } from "../../domain/brokerage/types.js";
import type {
  OrderLedgerRepository,
  OrderLifecycleState,
  OrderMetadata
} from "../../domain/execution/types.js";
import { moneyToDecimalString } from "../../shared/money.js";

export class PostgresOrderLedgerRepository implements OrderLedgerRepository {
  private readonly pool: Pool;

  public constructor(pool: Pool) {
    this.pool = pool;
  }

  public async createPendingOrder(sequenceId: string, order: OrderPayload): Promise<void> {
    await this.pool.query(
      `insert into order_ledger (
         sequence_id,
         client_order_id,
         user_id,
         account_id,
         ticker,
         side,
         order_type,
         time_in_force,
         notional,
         quantity,
         state,
         metadata,
         created_at,
         updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', '{}'::jsonb, now(), now())
       on conflict (client_order_id) do nothing`,
      [
        sequenceId,
        order.clientOrderId,
        order.userId,
        order.accountId,
        order.ticker,
        order.side,
        order.type,
        order.timeInForce,
        order.notional ? moneyToDecimalString(order.notional) : null,
        order.quantity ?? null
      ]
    );
  }

  public async transitionOrder(clientOrderId: string, from: OrderLifecycleState, to: OrderLifecycleState, metadata: OrderMetadata): Promise<boolean> {
    const result = await this.pool.query(
      `update order_ledger
          set state = $3,
              metadata = metadata || $4::jsonb,
              updated_at = now()
        where client_order_id = $1
          and state = $2`,
      [clientOrderId, from, to, JSON.stringify(metadata)]
    );
    return result.rowCount === 1;
  }

  public async markOrderState(clientOrderId: string, state: OrderLifecycleState, metadata: OrderMetadata): Promise<void> {
    await this.pool.query(
      `update order_ledger
          set state = $2,
              metadata = metadata || $3::jsonb,
              updated_at = now()
        where client_order_id = $1`,
      [clientOrderId, state, JSON.stringify(metadata)]
    );
  }

  public async appendBrokerResult(clientOrderId: string, result: BrokerOrderResult): Promise<void> {
    await this.pool.query(
      `update order_ledger
          set broker_order_id = coalesce($2, broker_order_id),
              metadata = metadata || $3::jsonb,
              updated_at = now()
        where client_order_id = $1`,
      [
        clientOrderId,
        result.brokerOrderId ?? null,
        JSON.stringify({
          brokerStatus: result.status,
          brokerMessage: result.message ?? null,
          acceptedAt: result.acceptedAt?.toISOString() ?? null
        })
      ]
    );
  }

  public async markSequenceAlert(sequenceId: string, reason: string, metadata: OrderMetadata): Promise<void> {
    await this.pool.query(
      `insert into execution_sequence_alerts (sequence_id, reason, metadata, created_at)
       values ($1, $2, $3::jsonb, now())`,
      [sequenceId, reason, JSON.stringify(metadata)]
    );
  }
}
