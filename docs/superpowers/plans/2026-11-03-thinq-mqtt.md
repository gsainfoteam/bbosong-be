# ThinQ MQTT Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Ingest ThinQ dryer state via MQTT push/events, with sparse REST reconcile for DRY machines only.

**Architecture:** Extend `ThinqService` with route/client/certificate/event REST helpers; add `ThinqMqttService` for mTLS MQTT and partial-report merge; shrink `ThinqPollingService` to reconcile-only.

**Tech Stack:** NestJS, `mqtt`, `node-forge` (CSR), existing Axios `ThinqService`, Jest.

## Global Constraints

- Single BE instance; stable `THINQ_CLIENT_ID`
- Reuse `MachineService.updateThinqDryerState`
- `THINQ_POLL_INTERVAL_SECONDS` default 600, min 300 (reconcile)
- Do not commit secrets; certs in memory only
- Answer/docs in Korean when talking to user; code/comments English

---

### Task 1: ThinqService REST helpers + reconcile interval

**Files:**
- Modify: `src/thinq/thinq.service.ts`
- Modify: `src/thinq/thinq.service.spec.ts`
- Modify: `.env.example`

- [ ] Refactor shared request helper for GET/POST/DELETE
- [ ] Add `getRoute`, `registerMqttClient`, `issueMqttCertificate`, `subscribeEvent`, `unsubscribeEvent`
- [ ] Change poll interval default/min to 600/300
- [ ] Tests for new endpoints and interval bounds
- [ ] Update `.env.example` comments

### Task 2: Partial report merge helper

**Files:**
- Create: `src/thinq/thinq-state-merge.ts`
- Create: `src/thinq/thinq-state-merge.spec.ts`

- [ ] `mergeThinqDryerReport(previous, report) -> ThinqDryerState`
- [ ] Tests: timer-only, runState-only, both, empty

### Task 3: ThinqMqttService

**Files:**
- Create: `src/thinq/thinq-mqtt.service.ts`
- Create: `src/thinq/thinq-mqtt.service.spec.ts`
- Modify: `src/thinq/thinq.module.ts`
- Modify: `src/machine/machine.module.ts`
- Dependencies: `mqtt`, `node-forge`

- [ ] Prepare MQTT (register, CSR, cert, Amazon Root CA)
- [ ] Connect, subscribe topic, reconnect with backoff
- [ ] Subscribe events for mapped dryers; refresh periodically
- [ ] On message: merge cache, resolve machine by `thinqDeviceId`, call `updateThinqDryerState`
- [ ] Unit tests with mocked mqtt/ThinqService/MachineService

### Task 4: Reconcile-only polling

**Files:**
- Modify: `src/machine/thinq-polling.service.ts`
- Modify: `src/machine/thinq-polling.service.spec.ts`

- [ ] Poll only `DRY` mapped dryers (plus full snapshot helper usable after MQTT reconnect)
- [ ] Keep device-list refresh; raise interval semantics
- [ ] Update tests

### Task 5: Verify

- [ ] Run ThinQ-related unit tests
- [ ] Lint touched files
