# LDB-38 기기 완료 확인 및 재등록 (FE LDF-41 계약)

## 등록 및 모달

기존 `POST /machine/:uuid/register`는 요청 body 없이 인증된 사용자를 등록한다.
성공은 기존과 같이 HTTP 201, `{ "success": true }`다.
다른 사용자에게 등록되어 있으면 세션의 `startedAt`부터 경과한 시간을 확인한다.
기기의 전력/상태 변경 시각이 아니라 **진행 중인 사용 세션의 시작 시각**을 기준으로 한다.

- 30분 미만: HTTP 409, `errorCode: "MACHINE_ALREADY_REGISTERED"`.
- 정확히 30분 이상: HTTP 409, 아래 응답. FE는 “이전 세탁/건조가 완료되었나요?” 모달을 표시하고 `usageUuid`를 보관한다.
- 진행 중인 세션 없음: HTTP 404, `errorCode: "MACHINE_NOT_RUNNING"`.
- 기존 사용자 본인 또는 사용자 미등록 세션: 기존 등록 동작대로 성공한다.

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Confirm previous usage completion to register this machine.",
  "errorCode": "MACHINE_COMPLETION_CONFIRMATION_REQUIRED",
  "usageUuid": "123e4567-e89b-42d3-a456-426614174000"
}
```

`PATCH /machine/:uuid/notification`의 `notifyOnCompletion: true`도 같은 오류 구분을 제공한다.

## 사용자가 '예'를 선택했을 때

`POST /machine/:uuid/register/confirm-completion`

인증: 기존 UserGuard/Bearer 인증. 동일 성별의 기기에만 접근 가능하다.
요청 body:

```json
{ "usageUuid": "123e4567-e89b-42d3-a456-426614174000" }
```

성공: HTTP 201, `{ "success": true }`.

서버는 기기 행과 진행 중인 사용 행을 잠그고 현재 세션 UUID, 다른 등록 사용자 존재,
30분 이상 경과 조건을 다시 검증한다. 이전 세션 종료와 새 세션 생성을 하나의 트랜잭션으로 처리한다.
동시 요청은 하나만 성공한다. DB 생성 실패 시 이전 세션 종료도 롤백한다.

- 409 `MACHINE_USAGE_CHANGED`: 모달의 세션이 이미 다른 세션으로 바뀌었다. 등록 흐름을 다시 시작한다. 자동으로 새로운 세션을 강제 종료하지 않는다.
- 409 `MACHINE_ALREADY_REGISTERED`: 30분 미만, 본인 세션 또는 사용자 미등록 세션. 일반 등록 흐름으로 돌아간다.
- 404 `MACHINE_NOT_RUNNING`: 기존 사용이 이미 종료되어 현재 사용이 없다.
- 400: 잘못된 기기 UUID, 누락되거나 잘못된 `usageUuid`.
- 403: 기기와 사용자 성별 불일치. 401: 인증 실패.

## 이력과 알림 정책

현재 모델에는 사용 시간/남은 시간 숫자 필드가 없다.
이전 행은 UUID·사용자·`startedAt`을 보존하며 `endedAt = startedAt`으로 종료하여 사용 시간을 0으로 만든다.
`notifyOnCompletion = false`로 설정하고 이전 사용자의 `/machine/me`에서는 제거되며 `/machine/me/history`에는 남는다.
FE는 종료된 세션의 남은 시간을 0으로 취급한다. `endedAt`은 이 경우 실제 확인 시각이 아니다.
새 세션은 새 UUID, 확인 시각의 `startedAt`, 새 사용자, `endedAt = null`, `notifyOnCompletion = true`로 생성된다.
기기 전력·상태는 그대로 유지한다. 기기가 실제로 비었다는 세탁실 구독 알림은 보내지 않는다.

DB 커밋 후 이전 사용자에게 기존 WebPushService로
“다른 사용자가 완료를 확인하고 기기를 등록했어요” 안내를 보낸다.
이 안내는 이전 `notifyOnCompletion` 설정과 무관하게 보낸다.
기존 모듈과 동일한 best-effort 방식으로, 구독이 없으면 생략하고 전송 실패를 기록한다.
푸시 실패는 등록을 롤백하지 않으며, 서버가 커밋 직후 중단되면 알림 전달은 보장되지 않는다.

30분 기준은 `libs/database/src/constants/machine-registration.ts`의
`MACHINE_REREGISTRATION_MIN_DURATION_MS` 상수로 공유한다. 스키마 변경/추가 마이그레이션은 없다.

## 검증

`bun run lint`, `bun run test --runInBand`, `bun run build`.
PostgreSQL 테스트는 `docs/machine-usage-history.md`의 전용 테스트 DB 실행 방법을 사용한다.
재등록 이력/현재 사용자, 서로 다른 사용자 동시 확인, 오래된 모달, 30분 재검증,
본인/미등록 세션 거절, 정상 종료 후 거절, 새 세션 생성 실패 시 롤백을 검증한다.
