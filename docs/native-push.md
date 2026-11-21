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

건조기 남은 시간을 잠금화면/Dynamic Island에 보여주는 Live Activity는 FCM으로 갱신할 수 없어, 서버가 APNs(`apns-push-type: liveactivity`)로 직접 보낸다. 기존 FCM 완료 알림(alert)과는 별개이며, Live Activity 종료(end)는 alert 없이 무음으로 보낸다.

### API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/machine/:uuid/live-activity` | Live Activity push token 등록. body `{ pushToken, environment }` |
| `DELETE` | `/machine/:uuid/live-activity` | 등록 해제. body `{ pushToken }` (없는 토큰도 200) |

- `pushToken`: ActivityKit `pushTokenUpdates`의 hex 문자열. **activity마다, 기기마다 다르고 도중에 바뀔 수 있으므로** 바뀔 때마다 다시 등록한다(upsert).
- `environment`: `SANDBOX`(Debug 빌드) / `PRODUCTION`(TestFlight·App Store). 서버가 APNs 호스트(`api.sandbox.push.apple.com` / `api.push.apple.com`)를 고르는 데만 쓴다.
- 요청한 사용자의 진행 중 세션이 있어야 한다(없으면 404, 남의 세션이면 403). 세션이 방금 끝났다면(8시간 이내) 토큰을 저장하지 않고 즉시 end를 보낸다.
- 한 세션에 여러 기기의 토큰이 등록될 수 있고, 서버는 모두에게 보낸다. 기기 간 자동 전파는 없다(각 기기 앱이 자기 activity를 시작하고 토큰을 등록해야 한다).

### 발송

- 세션 종료(`MachineService.finishUsingMachine`) 시 해당 세션의 모든 토큰에 `event: end`를 보내고 토큰을 삭제한다. `notifyOnCompletion`과 무관하다.
- 410 또는 400 `BadDeviceToken`/`DeviceTokenNotForTopic`은 무효 토큰으로 본다. 429/5xx/네트워크 오류는 최대 3회 시도한다. 8시간 이상 지난 토큰은 등록 시 정리한다.
- content-state(키는 Swift `ContentState`의 `Codable` 키와 정확히 일치해야 한다. 시간은 epoch 초):

```json
{ "state": "END", "endsAt": 1790000000, "remainingMinutes": 0, "updatedAt": 1790000000 }
```

`state`는 `RUNNING | COOLING | PAUSE | DETECTING | END | ERROR`. end에는 `dismissal-date`를 지정하지 않는다. iOS 기본 동작대로 종료된 Live Activity가 잠금화면에 최대 4시간 남고, 사용자가 직접 지울 수 있다(Dynamic Island에서는 즉시 사라진다). 앱은 수거 확인 등 시점에 로컬에서 `activity.end(..., dismissalPolicy: .immediate)`로 지울 수 있다.

### 환경변수

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `APNS_KEY_P8` | 아니오 | APNs 인증 키(.p8) PEM 또는 그 base64. 비밀 값. 하나라도 미설정이면 Live Activity 발송은 비활성화(경고 로그)된다 |
| `APNS_KEY_ID` | 아니오 | 키의 Key ID(10자) |
| `APNS_TEAM_ID` | 아니오 | Apple Developer Team ID(10자) |
| `APNS_BUNDLE_ID` | 아니오 | iOS 앱 번들 ID. `apns-topic`은 `<번들 ID>.push-type.liveactivity` |

키 하나로 SANDBOX/PRODUCTION 모두 발송한다. 위 FCM용으로 올린 .p8을 재사용할 수 있지만 서버에도 별도로 주입해야 한다.
