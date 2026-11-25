# 네이티브 앱 푸시 (FCM)

Capacitor 앱(iOS/Android)은 Web Push를 쓸 수 없으므로 FCM 등록 토큰으로 알림을 받는다.
iOS도 FCM → APNs로 통일한다. 기존 Web Push 계약은 그대로다.

## API 설계 결정: 별도 엔드포인트(B)

`/notification/register`에 `platform`/`token`을 얹는 방식(A) 대신 별도 엔드포인트(B)를 택했다.

- A는 body가 `{endpoint, keys}` 또는 `{platform, token}`인 두 형태가 되어, 조건부 검증과 `oneOf` Swagger가 필요하다.
  전역 `ValidationPipe`가 `forbidNonWhitelisted`라서 한쪽 형태에 다른 쪽 필드가 섞이면 400이 되고, 기존 Web Push 클라이언트가 깨질 위험도 커진다.
- B는 DTO가 각각 단순하고 검증이 엄격하며, 기존 `/register`·`/unregister`는 한 줄도 바뀌지 않는다. Swagger도 형태별로 정확하다.

| 엔드포인트 | body | 비고 |
| --- | --- | --- |
| `POST /notification/register` | `{ endpoint, keys: { p256dh, auth } }` | 기존 Web Push (변경 없음) |
| `DELETE /notification/unregister` | `{ endpoint }` | 기존 Web Push (변경 없음, Swagger requestBody 명시) |
| `POST /notification/register/native` | `{ platform: "IOS" \| "ANDROID", token }` | 신규 |
| `DELETE /notification/unregister/native` | `{ token }` | 신규 |

모두 `Authorization: Bearer <access token>`만 필요하다. `User-Agent` 헤더는 요구하지 않는다(있으면 기록만 함).
성공 응답은 `{ "success": true }`.

### 동작

- 등록은 토큰 기준 upsert로 멱등이다.
- 같은 토큰이 다른 계정으로 등록되면 소유자가 새 계정으로 이전된다(계정 전환 시 이전 계정 알림이 가지 않음).
- 해제는 `userUuid + token`으로만 삭제한다. 이미 다른 계정으로 이전된 토큰이나 없는 토큰을 해제해도 200이며 아무것도 지우지 않는다.
  따라서 로그아웃 시 이전 계정 토큰으로 해제를 호출해도 새 소유자의 등록을 지우지 않는다.
- `platform`은 저장소 컨벤션대로 대문자 enum이다(`IOS`, `ANDROID`). Capacitor의 `getPlatform()`은 소문자이므로 `toUpperCase()`가 필요하다.

## 데이터 모델

`user_push_subscription`에 `platform`(`WEB|IOS|ANDROID`, 기본 `WEB`)과 `fcm_token`(unique)을 추가하고
`endpoint`/`p256dh`/`auth`를 nullable로 바꿨다. 기존 행은 모두 `WEB`이 된다.
DB CHECK 제약으로 `WEB`은 endpoint·p256dh·auth 필수 + fcm_token 없음, `IOS`/`ANDROID`는 fcm_token만 허용한다.

## 발송

`NotificationService`의 모든 알림(기기 완료/오류/연결 끊김, 세션 인수, 빈 기기)이 Web Push와 FCM으로 동시에 팬아웃된다.
한 채널이 실패해도 다른 채널은 영향받지 않는다. 한 기기라도 수락하면 "전달됨"으로 취급한다(빈 기기 알림의 구독 삭제 판단 기준).

payload 의미는 동일하다: `title`, `body`, `url`, `icon`, `data`.
FCM에서는 `notification`(title/body) + data map으로 전달하며 data 값은 모두 문자열이다
(`url`, `icon`, 그리고 `data`의 각 키; 객체는 JSON 문자열).

모든 알림 `data`에 `type`이 들어간다.

| `data.type` | 추가 필드 | 용도 |
| --- | --- | --- |
| `machine-completion` | `machineUuid` | 완료 알림 |
| `machine-error` | `machineUuid` | 오류 알림 |
| `machine-reregistered` | `machineUuid` | 다른 사용자가 기기를 인수 |
| `laundry-room-available` | `location`, `gender`, `machineType` | 빈 기기 알림. 서버가 발송 직후 해당 세탁실 구독을 삭제하므로 이 값으로 토글을 동기화 |
| `machine-offline` | `machineUuid` | 관리자용 연결 끊김 |

플랫폼 설정:

- Android: `priority: high`, 채널 `FCM_ANDROID_CHANNEL_ID`(기본 `default`), `sound: default`. 알림 아이콘은 앱의 기본 아이콘 메타데이터를 따른다
  (FCM의 Android `icon`은 URL이 아닌 리소스 이름이라 `icon`은 data로만 전달).
  **앱이 같은 ID의 채널을 만들어야 한다.** 없으면 기본(Misc) 채널로 표시된다.
- iOS(APNs): `apns-priority: 10`, `apns-push-type: alert`, `sound: default`. badge는 의미 있는 카운트가 없어 설정하지 않는다.

### 무효 토큰 정리

`messaging/registration-token-not-registered`, `messaging/invalid-registration-token`이면 해당 기기를 자동 삭제한다.
`messaging/invalid-argument`는 메시지에 "registration token"이 있을 때만 토큰 문제로 보고 삭제한다(payload 오류로 정상 기기가 지워지는 것을 방지).
그 외 오류(서버 불가, 자격 불일치 등)는 기기를 남기고 로그만 남긴다. Web Push의 404/410 정리와 같은 방식이다.

## 환경변수

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 아니오 | Firebase 서비스 계정 키 JSON 또는 그 base64. 비밀 값이므로 레포에 커밋 금지. 미설정이면 FCM은 비활성화(경고 로그)되고 Web Push만 동작한다 |
| `FCM_ANDROID_CHANNEL_ID` | 아니오 | Android 알림 채널 ID, 기본 `default` |

운영 값은 `gsainfoteam/icarus-gitops`의 `infoteam/service-v2/bbosong/<env>/values.yaml`(시크릿 포함)에 추가해야 한다.

## 사람이 해야 하는 설정 체크리스트

1. Firebase 콘솔에서 프로젝트 생성(또는 기존 프로젝트 선택) 후 Android 앱(패키지명)과 iOS 앱(번들 ID)을 등록한다.
2. 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성"으로 JSON을 받는다. (FCM HTTP v1 권한이 있는 계정이어야 한다.)
3. Apple Developer에서 APNs 인증 키(.p8)를 발급하고 Firebase 콘솔 → 클라우드 메시징 → Apple 앱 구성에 업로드한다 (Key ID, Team ID 필요).
4. 프런트 앱에 `google-services.json`(Android)·`GoogleService-Info.plist`(iOS)를 넣고, iOS는 Push Notifications / Background Modes(Remote notifications) capability를 켠다.
5. 서비스 계정 JSON을 gitops 시크릿에 `FIREBASE_SERVICE_ACCOUNT_JSON`으로 등록한다(staging → production). 필요하면 `FCM_ANDROID_CHANNEL_ID`도 추가한다.
6. 앱에서 `FCM_ANDROID_CHANNEL_ID`와 같은 ID로 Android 알림 채널을 생성한다.
7. 배포 후 로그에 `FCM push to native devices is disabled` 경고가 없는지 확인하고, 테스트 기기에서 실제 수신을 확인한다.

## iOS Live Activity (APNs 직접 발송)

건조기 남은 시간을 잠금화면/Dynamic Island에 보여주는 Live Activity는 FCM으로 갱신할 수 없어, 서버가 APNs(`apns-push-type: liveactivity`)로 직접 보낸다. 기존 FCM 완료 알림(alert)과는 별개이며, Live Activity 푸시는 모두 alert 없이 무음이다.

### API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/machine/:uuid/live-activity` | Live Activity push token 등록. body `{ pushToken, environment }` |
| `DELETE` | `/machine/:uuid/live-activity` | 등록 해제. body `{ pushToken }` (없는 토큰도 200) |

- `pushToken`: ActivityKit `pushTokenUpdates`의 hex 문자열. **activity마다, 기기마다 다르고 도중에 바뀔 수 있으므로** 바뀔 때마다 다시 등록한다(upsert).
- `environment`: `SANDBOX`(Debug 빌드) / `PRODUCTION`(TestFlight·App Store). 서버가 APNs 호스트(`api.sandbox.push.apple.com` / `api.push.apple.com`)를 고르는 데만 쓴다.
- 요청한 사용자의 진행 중 세션이 있어야 한다(없으면 404, 남의 세션이면 403). 세션이 방금 끝났다면(8시간 이내) 토큰을 저장하고 즉시 "완료" 상태를 보낸다.
- 한 세션에 여러 기기의 토큰이 등록될 수 있고, 서버는 모두에게 보낸다. 기기 간 자동 전파는 없다(각 기기 앱이 자기 activity를 시작하고 토큰을 등록해야 한다).

### 발송 시점

| 시점 | 이벤트 | 비고 |
| --- | --- | --- |
| ThinQ 건조기 진행 중 상태/남은 시간 변경 | `update` | 상태가 바뀌면 즉시(priority 10), 종료 예상 시각이 2분 이상 어긋났을 때만(priority 5, 세션당 60초 간격 제한). 전송이 실패하면 다음 동기화에서 같은 내용을 다시 보낸다. 카운트다운 자체는 앱이 `Text(timerInterval:)`로 그린다 |
| `RUNNING`/`COOLING` 세션의 `endsAt`이 지났는데 아직 끝나지 않음(15초 확인 주기) | `update` (priority 10) | 같은 `state`, `endsAt` 그대로, `remainingMinutes: 0`, `updatedAt`=현재를 세션당 1회. 위젯이 "곧 끝나요"로 다시 그린다(세탁기는 입력한 시간보다 오래 돌 수 있다). 일부 기기 전송 실패 시 최대 3회(첫 발송 포함). `endsAt`이 미래로 늘어나면 다시 대기한다 |
| 세션 종료(`finishUsingMachine`) | `update` (`state: END`) | **`end`를 보내지 않는다.** 완료 후에도 Dynamic Island/잠금화면에 남는다. 토큰도 유지. `notifyOnCompletion`과 무관 |
| 다른 사용자가 완료 확인 후 같은 기계를 재등록 | `update` (`state: END`) | 이전 사용자는 여전히 수거해야 하므로 `end`를 보내지 않고 "완료"로 남긴다. 같은 기계에 새 세션이 시작돼도 이전 사용자의 activity에는 아무것도 보내지 않는다 |
| 사용자가 `DELETE /machine/:uuid/register`로 기계 추적을 해제 | `end` | 그 사용자의 해당 기계 activity(진행 중·완료 상태 모두)를 즉시 제거하고 토큰 삭제. 진행 중 세션이 없어 404를 반환하는 경우에도 정리한다. APNs 전송이 실패한 토큰은 남겨 두었다가, 이후 세션의 update/완료 시점에 `end`만 다시 시도한다(일반 update는 보내지 않는다) |
| 앱이 로컬에서 `activity.end` (수거 확인 등) | - | 앱이 `DELETE /machine/:uuid/live-activity`로 토큰을 정리 |

- 완료 후 activity는 앱이 끝내거나(수거 확인 등), 사용자가 추적을 해제하거나(위 표), 시스템이 종료할 때까지 남는다. iOS는 시작 후 최대 8시간이면 시스템이 종료한다. 9시간 이상 지난 토큰은 등록 시 정리한다.
- 410 또는 400 `BadDeviceToken`/`DeviceTokenNotForTopic`은 무효 토큰으로 보고 삭제한다. 429/5xx/네트워크 오류는 최대 3회 시도한다.
- content-state(키는 Swift `ContentState`의 `Codable` 키와 정확히 일치해야 한다. 시간은 epoch 초):

```json
{ "state": "RUNNING", "endsAt": 1790001200, "remainingMinutes": 20, "updatedAt": 1790000000 }
```

`state`는 `RUNNING | COOLING | PAUSE | DETECTING | END | ERROR`(ThinQ 상태를 서버가 매핑). 남은 시간을 모를 때(`DETECTING` 등)는 `endsAt`, `remainingMinutes`가 `null`이다.

### 환경변수

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `APNS_KEY_P8` | 아니오 | APNs 인증 키(.p8) PEM 또는 그 base64. 비밀 값. 하나라도 미설정이면 Live Activity 발송은 비활성화(경고 로그)된다 |
| `APNS_KEY_ID` | 아니오 | 키의 Key ID(10자) |
| `APNS_TEAM_ID` | 아니오 | Apple Developer Team ID(10자) |
| `APNS_BUNDLE_ID` | 아니오 | iOS 앱 번들 ID. `apns-topic`은 `<번들 ID>.push-type.liveactivity` |

키 하나로 SANDBOX/PRODUCTION 모두 발송한다. 위 FCM용으로 올린 .p8을 재사용할 수 있지만 서버에도 별도로 주입해야 한다.

## Android Live Update (FCM data-only)

Android 16 Live Update(`Notification.ProgressStyle`)는 서버 `notification` 페이로드로 만들 수 없어, 앱이 **data-only 메시지**를 받아 로컬에서 알림을 게시/갱신한다. 새 토큰 API는 없고 기존 `POST /notification/register/native`를 쓴다.

### 구독 플래그와 중복 방지

`POST /notification/register/native` body에 optional `supportsLiveUpdate: boolean`을 추가했다(`user_push_subscription.supports_live_update`, 기본 `false`).

- `platform: ANDROID` + `supportsLiveUpdate: true`인 구독만 Live Update 대상이다. iOS에서 보내면 무시(`false` 저장)한다.
- 이 구독에는 상태 전이 알림(`machine-completion`, `machine-error`, `machine-reregistered`)의 일반 `notification` 푸시를 **보내지 않고** Live Update 메시지(`END`/`ERROR` 상태)만 보낸다. 빈 기기 알림(`laundry-room-available`) 등 세션과 무관한 푸시는 그대로 간다.
- 값은 토큰 기준 upsert 시 매번 덮어쓴다. 재등록 때 생략하면 `false`로 돌아가므로 앱은 등록할 때마다 값을 함께 보내야 한다. 기존 구독은 마이그레이션 기본값 `false`라 동작이 바뀌지 않는다.

### 메시지

`notification` 없이 `data`만, `android.priority: "high"`. 모든 값은 문자열이며 **null 값은 키를 생략**한다(빈 문자열을 보내지 않는다). 시간은 epoch 초, 분은 10진 문자열.

| 키 | 항상 존재 | 설명 |
| --- | --- | --- |
| `type` | O | 항상 `LIVE_UPDATE` |
| `machineUuid` | O | 기계 UUID. 알림 ID/갱신 키로 사용 |
| `kind` | O | `WASHER` \| `DRYER` |
| `title` | O | 예: `A동 건조기 3번` |
| `state` | O | `RUNNING` \| `COOLING` \| `PAUSE` \| `DETECTING` \| `END` \| `ERROR` |
| `updatedAt` | O | 이 상태를 계산한 시각 |
| `startedAt` | 알 때만 | 세션 시작 시각. 사용자가 추적을 해제해 보내는 `END`에는 없다 |
| `endsAt` | 알 때만 | 예상 종료 시각. 남은 시간을 모르면(`DETECTING` 등) 생략 |
| `remainingMinutes` | 알 때만 | 남은 분. 모르면 생략 |

`END`(`endsAt`=현재, `remainingMinutes`=`0`)와 `ERROR`가 종료 신호다. OS가 진행 막대를 자동으로 움직여 주지 않으므로, 앱은 **메시지를 받을 때마다** `startedAt`~`endsAt` 구간으로 막대를 다시 계산해 알림을 갱신한다. 서버는 진행 중 세션에 주기적으로 tick(같은 `LIVE_UPDATE`, 새 필드 없음)을 보낸다. 같은 `state`로 다시 오는 메시지는 보정/tick이므로 앱은 알림을 새 값으로 갱신하면 된다. tick의 `state`/`endsAt`은 서버가 아는 최신 값, `remainingMinutes`는 tick 시점 기준(올림), `updatedAt`은 tick 시각이다.

### 발송 시점

세션 owner(`using_machine.user_uuid`)의 구독에만 보낸다.

| 시점 | 메시지 |
| --- | --- |
| ThinQ 건조기 진행 중 **상태가 바뀔 때**(또는 세션 owner가 바뀌었을 때) | 해당 `state`. 기기에 닿지 못하면 다음 동기화에서 재시도 |
| 같은 상태에서 **종료 예상 시각이 2분 이상 어긋났을 때**(또는 남은 시간이 알려지거나 사라졌을 때) | 갱신된 `endsAt`/`remainingMinutes`. 세션당 60초 간격 제한. iOS Live Activity와 같은 규칙 |
| 위 메시지(전이/보정/tick) 중 마지막 발송 후 **tick 간격**이 지났고 `endsAt`을 알 때(`RUNNING`/`COOLING`/`PAUSE`, 아직 `endsAt` 전) | tick. 상태 전이·보정 발송 시점부터 타이머가 다시 시작돼 직후 중복 발송이 없다. 일부 기기 전송 실패 시 다음 tick에서 다시 시도한다 |
| `endsAt`을 아는 `RUNNING`/`COOLING` 건조기 세션이 `endsAt`에 **도달하거나 지난 뒤 처음 확인될 때**(15초 확인 주기) | 마무리 `LIVE_UPDATE` 1회: 그 시점의 최신 `state`와 `endsAt`(그대로), `remainingMinutes`=`"0"`. tick 간격과 무관하게 즉시 보낸다. 앱은 `now >= endsAt`로 판단해 카운트다운 없이 "곧 끝나요"/진행률 100%로 그린다. 같은 `endsAt`에는 한 번만 보낸다 |
| 세션 종료(`finishUsingMachine`) | `END` (`notifyOnCompletion`과 무관) |
| 다른 사용자가 완료 확인 후 기계를 재등록 | 이전 사용자에게 `END` |
| 사용자가 `DELETE /machine/:uuid/register`로 추적 해제 | 그 사용자에게 `END` |

마무리 메시지 규칙:
- 대상은 `endsAt`을 아는 `RUNNING`/`COOLING` 세션이다. 건조기는 ThinQ의 `endsAt`, 세탁기는 사용자가 입력한 남은 시간(`estimatedEndsAt`)이 있을 때만 해당한다(세탁기는 입력한 시간보다 오래 돌 수 있다). `endsAt`을 모르는 상태(`DETECTING` 등), `PAUSE`, `END`/`ERROR`는 제외한다. 이후에는 tick을 보내지 않고, `END`/`ERROR`는 기존처럼 종료 처리한다.
- **이미 지난 `endsAt`으로 새로 기록되는 세션(등록·상태 전이·보정 시점에 `endsAt <= 현재`)에는 마무리 메시지를 따로 보내지 않는다.** 그 시점에 나가는 전이/보정 메시지가 이미 지난 `endsAt`을 담고 있어 앱이 "곧 끝나요"로 그리기 때문이다.
- ThinQ 동기화로 `endsAt`이 미래로 늘어나면 마무리 상태가 리셋되어 일반 tick이 다시 동작하고, 새 `endsAt`에 도달하면 마무리 메시지를 다시 한 번 보낸다. 늘어난 `endsAt`은 기존 보정 규칙(2분 이상 어긋남, 60초 간격 제한)으로 앱에 전달된다. 2분 미만 연장은 보정 대상이 아니지만 다음 tick이 최신 `endsAt`을 담아 보낸다.
- 일부 기기 전송 실패 시 tick 간격마다 재시도하며 최대 3회(첫 발송 포함)에서 포기한다. 무효 토큰 정리는 기존 `deliver()` 경로다. owner의 Live Update 기기가 없으면 세션 추적을 멈춘다.
- `LIVE_UPDATE_TICK_INTERVAL_SECONDS=0`(tick 비활성화)이면 마무리 메시지도 보내지 않는다.

tick은 `endsAt`을 모르는 상태(`DETECTING` 등), `END`/`ERROR`, 세탁기(세탁기는 진행·마무리 메시지만 받는다), `endsAt`이 지난 세션에는 보내지 않는다. 세션 종료·추적 해제·owner 변경(이전 owner)이면 중단하고, owner의 Live Update 기기가 하나도 없으면(구독 해제/`supportsLiveUpdate=false`) 그 세션의 tick을 멈춘다(다음 ThinQ 동기화에서 다시 등록).

### tick 설정

| 환경 변수 | 필수 | 설명 |
| --- | --- | --- |
| `LIVE_UPDATE_TICK_INTERVAL_SECONDS` | 아니오 | tick 간격(초). 기본 `180`, 허용 `60`~`3600`(범위 밖/잘못된 값은 기본값), `0`이면 tick 비활성화. 서버는 15초마다 만료된 세션을 확인하므로 실제 간격은 최대 15초 늦을 수 있다 |

### 한계

- dedupe/tick 상태는 **메모리**다. 서버 재시작 후에는 전이 메시지가 한 번 더 갈 수 있고, 세션이 다음 ThinQ 동기화(MQTT 이벤트 또는 REST 보정)로 다시 등록될 때까지 tick이 멈춘다.
- 다중 인스턴스 간 조정(락/리더 선출)은 없다. ThinQ 동기화·MQTT·기존 Live Update 전이 발송과 마찬가지로 단일 인스턴스를 전제로 하며, 여러 인스턴스를 띄우면 인스턴스 수만큼 tick이 중복 발송된다.

무효 토큰(`UNREGISTERED` 등)은 일반 푸시와 같은 방식으로 구독을 삭제한다.
