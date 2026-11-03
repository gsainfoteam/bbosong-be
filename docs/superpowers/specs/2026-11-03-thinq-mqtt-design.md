# ThinQ MQTT Event Ingestion Design

**Date:** 2026-11-03  
**Status:** Approved  
**Context:** ~30 ThinQ-mapped dryers; REST polling every 60s hits account-scoped rate limits.

## Goal

Replace continuous ThinQ REST polling with MQTT push/event ingestion so dryer run state and remaining time update without exhausting the Connect API quota.

## Non-goals

- ThinQ Business API partnership
- Multi-instance MQTT leader election (single BE instance)
- Matter path changes
- Device control over MQTT (subscribe-only)

## Approach

MQTT primary + sparse REST reconcile.

1. On boot (when ThinQ is enabled): register MQTT client, issue certificate via CSR, connect to AWS IoT endpoint from `GET /route`, subscribe to the returned topic.
2. For each mapped dryer `thinqDeviceId`: `POST /event/{deviceId}/subscribe` with long expiry.
3. On MQTT message: merge partial `report` into a per-device cache, map `deviceId` → machine, call existing `MachineService.updateThinqDryerState`.
4. REST reconcile only on startup/reconnect and periodically for machines already in `DRY` status (default every 10 minutes).

## Partial report merge

ThinQ push payloads often include only changed fields (e.g. `timer.remainMinute` without `remainHour` or `runState`). Keep a process-local cache per `deviceId` and deep-merge `report` before applying lifecycle logic. Omitted fields keep the previous cached value; present fields overwrite.

## Components

| Piece | Responsibility |
|---|---|
| `ThinqService` | Existing REST + new route/client/certificate/event subscribe helpers; shared rate-limit backoff |
| `ThinqMqttService` | Cert lifecycle, MQTT connection, subscriptions, message → merge → `updateThinqDryerState` |
| `ThinqPollingService` | Renamed role: reconcile-only (startup + DRY machines on long interval) |
| `mqtt` + `node:crypto` | mTLS MQTT client and RSA CSR generation |

## Config

- Reuse `THINQ_PAT`, `THINQ_COUNTRY_CODE`, `THINQ_CLIENT_ID`, `THINQ_API_KEY`, `THINQ_BASE_URL`
- `THINQ_CLIENT_ID` must stay stable across restarts
- Reinterpret `THINQ_POLL_INTERVAL_SECONDS` as reconcile interval: default **600**, minimum **300**, maximum 86400
- Certificates/keys live in memory only; re-issued each process start

## Failure handling

- MQTT disconnect: exponential reconnect; after reconnect, re-subscribe events and run one full mapped-dryer snapshot
- REST 429: existing shared backoff
- Unknown `deviceId` in push: ignore
- Unmapped dryer: ignore after lookup miss

## Testing

- Unit: partial merge, MQTT message routing to `updateThinqDryerState`, reconcile only polls DRY machines
- Extend ThinQ HTTP client tests for new endpoints
- Keep existing `updateThinqDryerState` lifecycle tests unchanged
