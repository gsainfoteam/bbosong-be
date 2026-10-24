# 기기 사용 이력

`UsingMachine`은 기기 한 대당 한 행이 아니라 실제 운전 세션 한 번당 한 행을 저장한다.
`Machine.usages`는 1:N 관계이며, `endedAt = null`이면 진행 중인 세션이다.
PostgreSQL의 부분 유일 인덱스로 기기당 진행 중인 세션을 하나만 허용한다.
이 인덱스와 사용 기간 CHECK 제약은 SQL 마이그레이션에서 관리한다.

- 운전 시작: 새 UUID로 세션을 생성한다. 진행 중인 세션이 있으면 재시도로 간주하고 기존 사용자와 시작 시각을 보존한다.
- 운전 완료: 행을 삭제하지 않고 `endedAt`을 기록한다. 종료된 세션으로 완료 알림을 보내며 중복 종료는 알림을 다시 보내지 않는다.
- 알림 등록·해제 및 사용자 등록 취소: 진행 중인 세션만 수정한다. 등록 취소는 잘못 등록한 사용자의 연결을 제거하는 기존 동작을 유지하므로, 취소한 세션은 해당 사용자의 이력에 포함되지 않는다.
- 기기 생성: 사용 세션을 생성하지 않는다.
- 기기 삭제: `deletedAt`을 기록하는 soft delete다. 기기·사용·전력 행과 FK를 보존하며, 삭제된 기기는 목록·상세·QR·세탁실 집계·전력·내 사용 및 완료 이력 조회에서 제외한다. 삭제 후 기기 변경·등록 및 운전 이벤트 처리도 거절한다. 다시 삭제하면 404를 반환한다.
- `isAvailable = false`는 일시 사용 불가 상태로, 목록에는 계속 표시된다.
- 삭제된 기기의 위치·성별·종류·번호 조합과 MAC 주소는 새 기기에 재사용할 수 있다. 활성 기기의 중복은 SQL 마이그레이션의 부분 유일 인덱스로 차단한다. QR 코드(`shortCode`)는 삭제 후에도 고유하게 보존하여 예전 QR이 새 기기로 연결되지 않도록 한다.

## API

기존 `GET /machine/me`와 기기 상세의 `currentUsage`는 진행 중인 세션만 반환한다.
`GET /machine/me/history?limit=20&offset=0`은 인증된 사용자의 완료 이력을 시작 시각 내림차순으로 반환한다.
`limit`은 1~100(기본 20), `offset`은 0 이상(기본 0)이다.
응답은 기존 사용 세션 필드에 `endedAt`을 추가한 배열이다.

삭제된 기기는 `GET /machine`, `GET /machine/:uuid`, `GET /machine/by-shortlink`,
`GET /machine/summary`, `GET /machine/me`, `GET /machine/me/history`,
`GET /machine/:uuid/power`에서 제외한다. 상세·QR 조회는 404, 전력 조회는 빈 배열을 반환한다.
내 사용·완료 이력은 `machine.deletedAt = null` 관계 필터를 적용한 후 페이지네이션한다.
기기 상세의 사용 세션 include와 링크 재생성·일괄 재생성 대상 조회도 활성 기기만 사용한다.

`bbosong-fe`는 API 목록을 렌더링하고 상세·QR의 404를 처리하므로 soft delete 노출 필터를 추가할 필요가 없다.
삭제 직후 화면 갱신을 개선하려면 관리자 삭제 성공 시 내 사용·완료 이력·QR 조회의 React Query 캐시도 무효화할 수 있다.

## 배포

```sh
bunx prisma migrate deploy
bunx prisma generate
```

`20261020000000_preserve_machine_usage_history`는 기존 행을 삭제하지 않는다.
현재 IDLE인 기기의 기존 행은 마이그레이션 시점에 종료 처리하고, 운전 중인 기기의 행은 열린 세션으로 유지한다.
기존 종료 시각이 없으므로 이관된 IDLE 기록의 `endedAt`은 실제 완료 시각이 아니라 이관 기준 시각이다.
이미 덮어쓰거나 삭제한 과거 이력은 이 마이그레이션으로 복구할 수 없다.
마이그레이션과 새 서버 배포는 기존 서버의 세션 삭제·덮어쓰기 코드가 더 이상 실행되지 않도록 함께 진행한다.

`20261024000000_add_machine_soft_delete`는 nullable `machine.deleted_at`을 추가하고
위치·성별·종류·번호 및 MAC 유일 인덱스를 활성 기기만 대상으로 교체한다. 기존 기기는 모두 활성 상태로 유지한다.
이 부분 유일 인덱스는 기존 세션 인덱스와 마찬가지로 Prisma 모델의 `@unique`가 아닌 SQL 마이그레이션으로 관리한다.

## PostgreSQL 회귀 테스트

```sh
MACHINE_USAGE_TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/TEST_DB bun run test:machine-usage
```

로컬 테스트 DB를 사용한다. 테스트는 무작위 이름의 전용 스키마에서 기존 마이그레이션을 적용하고
기존 데이터를 새 구조로 이관한 뒤, 동시 시작·종료, 이력 누적, 현재 사용 조회, 알림 변경 범위,
부분 유일 인덱스, soft delete의 조회 제외·기록 보존·삭제 후 쓰기 차단 및 식별자 재사용을 확인한다. 종료 시 전용 스키마를 삭제한다.
