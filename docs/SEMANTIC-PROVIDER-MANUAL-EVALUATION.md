# 실제 Provider 수동 평가 절차

이 문서는 합성 semantic corpus를 OpenAI·Anthropic·Google 계열의 실제 모델에서 평가하고, SillyTavern의 `현재 채팅 연결` 경로와 공개 Connection Manager 프로필 경로가 같은 안전 경계를 지키는지 확인하기 위한 릴리스 절차다. 자동 테스트를 대체하지 않으며 실제 사용자 프롬프트로 품질을 시험하는 절차도 아니다.

기준 corpus는 [`test/fixtures/semantic-evaluation-corpus.json`](../test/fixtures/semantic-evaluation-corpus.json), 집계 규칙은 [`src/semantic-evaluation.js`](../src/semantic-evaluation.js)에 있다. 평가자는 corpus와 동일하게 목적에 맞게 작성한 합성 데이터만 사용해야 한다.

## 먼저 알아둘 현재 한계

일반 UI는 로컬 Rule Inspector가 만든 finding 또는 cluster를 사용자가 선택한 경우에만 AI 검사를 시작한다. 따라서 정적 finding이 없는 `문제 없음` corpus 사례를 UI만으로 그대로 재생할 수는 없다. 또한 확장 내부의 capture gate와 별도로 콘솔에서 provider adapter를 새로 만들면 자기 AI 요청을 일반 스냅샷으로 오인할 수 있다.

따라서 현재 버전에서 안전하게 실행할 수 있는 평가는 다음 두 범위로 나눈다.

1. 설치된 확장 UI에서 실제 provider 경로·미리보기·1회 동의·오류 정규화·자기 캡처 제외를 확인하는 연결 적합성 평가
2. UI에서 선택 가능한 합성 충돌 사례에 대한 제한된 의미 품질 평가

모든 corpus 사례, 특히 기대 제안이 0개인 음성 사례까지 실제 provider로 일괄 평가했다고 표기하려면 확장과 같은 `SemanticCaptureGate` 인스턴스를 사용하는 공식 수동 평가 harness가 먼저 필요하다. 그 전에는 해당 항목을 `통과`가 아닌 `미평가`로 기록한다. 브라우저 콘솔, 직접 `fetch`, provider SDK 또는 API key를 넣은 임시 스크립트로 이 경계를 우회하지 않는다.

향후 공식 harness는 `SemanticInspector`와 `SemanticProviderAdapter`의 기존 검증 경로를 그대로 사용하고, 일반 캡처와 같은 gate 인스턴스를 공유해야 한다. 각 유료 반복은 새 inspector를 만들거나 memory cache를 명시적으로 비워 실제 fresh 호출임을 보장해야 하며, 디스크에는 raw prompt·raw response 대신 case ID, 정규화된 제안 집계와 안정된 code/reason만 남겨야 한다.

## 평가 원칙

- 전용 테스트 계정·프로젝트와 낮은 지출 한도를 사용한다.
- 실제 채팅, 캐릭터 카드, 페르소나, 로어북, API key, endpoint URL, request ID를 평가 입력이나 기록에 넣지 않는다.
- 합성 입력을 만들 때도 이메일, 전화번호, 실존 인물, 실제 서비스 URL과 운영 credential처럼 보이는 문자열을 사용하지 않는다.
- AI 모드를 켜는 것과 provider 호출을 구분한다. 대상 선택, 전송 미리보기, 매회 초기화된 동의 체크, 실행 확인이 모두 끝나기 전에는 호출이 없어야 한다.
- `원문 제거본`과 `메타데이터만` 스냅샷은 차단 확인용으로만 사용한다. 의미 품질 평가는 새로 캡처한 `전체 원문` 합성 스냅샷에서만 한다.
- 평가 중 보이는 제안은 복사하거나 원본 프롬프트에 자동 적용하지 않는다. ST DevTools가 원본·정책·검토 판정을 변경하지 않았는지 확인한다.
- 취소와 timeout은 논리적 취소다. 이미 시작된 provider 계산이나 과금이 중단됐다고 가정하지 않는다.

## 고정 평가 행렬

provider family와 전송 경로는 서로 다른 축이다. 가능하면 아래 6개 셀을 각각 평가한다.

| 셀 | Provider family | 경로 | 준비 조건 |
| --- | --- | --- | --- |
| OAI-C | OpenAI | 현재 채팅 연결 | SillyTavern 현재 연결이 OpenAI 계열 모델을 가리킴 |
| OAI-P | OpenAI | Connection Manager | 공개 프로필이 OpenAI 계열 모델을 가리킴 |
| ANT-C | Anthropic | 현재 채팅 연결 | 현재 연결이 Anthropic/Claude 계열 모델을 가리킴 |
| ANT-P | Anthropic | Connection Manager | 공개 프로필이 Anthropic/Claude 계열 모델을 가리킴 |
| GGL-C | Google | 현재 채팅 연결 | 현재 연결이 Gemini/Google/Vertex 계열 모델을 가리킴 |
| GGL-P | Google | Connection Manager | 공개 프로필이 Google 계열 모델을 가리킴 |

OpenRouter나 OpenAI-compatible endpoint는 별도의 `compatible` 셀로 기록하며 실제 upstream을 추측해 OpenAI·Anthropic·Google 통과로 합치지 않는다. Connection Manager가 공개 프로필 API를 제공하지 않거나 특정 family를 지원하지 않으면 `해당 없음`이 아니라 `환경 미지원`으로 기록한다. 해당 셀은 전체 실제-provider 통과 선언에서 제외 사유를 명시해야 한다.

Chat Completion 프로필과 Text Completion 프로필을 모두 지원하는 환경에서는 family 행렬과 별도로 각 completion type을 최소 1회 확인한다. Text Completion은 system prompt·사용자 입력·prefill이 하나의 텍스트로 합쳐지고 JSON schema payload가 생략되는 경로이므로 Chat Completion 결과로 대신할 수 없다.

## 공통 준비

1. 평가할 commit hash, ST DevTools 버전, SillyTavern 버전, 브라우저 버전을 기록한다.
2. 같은 commit의 corpus version과 case ID 목록을 고정한다. 평가 도중 corpus가 바뀌면 이전 결과와 합치지 않고 새 세션으로 시작한다.
3. `npm test`와 `npm run check`를 먼저 통과시킨다. 자동 회귀가 실패한 build에는 실제 provider 비용을 쓰지 않는다.
4. 전용 테스트 채팅에서 목적에 맞게 작성한 합성 preset·캐릭터·페르소나만 사용한다. 각 corpus 사례는 독립 채팅 또는 독립 스냅샷으로 분리한다.
5. 캡처 모드를 `전체 원문`으로 설정해 새 스냅샷을 만든다. 기존 redacted/metadata 스냅샷을 full로 간주하지 않는다.
6. provider/model의 sampling 설정은 가능한 한 고정한다. provider가 지원하면 temperature를 가장 낮은 값으로 두되, ST DevTools를 위해 현재 채팅의 설정을 몰래 변경하지 않는다. 기록에는 값만 남긴다.
7. 기준 실행은 추가 AI 지시와 assistant prefill을 비운다. 사용자 지정 지시·prefill 호환성은 기준 평가가 끝난 뒤 별도 셀에서만 시험한다.
8. 응답 상한은 모든 셀에서 같은 값으로 시작한다. 권장 기준은 1,024 tokens이며, 잘린 JSON이 의심될 때만 새 미리보기·새 동의로 2,048까지 한 번 올린다.
9. Connection Manager 셀에서는 현재 채팅 연결과 다른 테스트 모델을 선택해 경로 혼동을 알아보기 쉽게 한다. 기록에는 화면에 표시된 provider/model과 평가용 별칭만 남기고 opaque profile ID, URL, credential은 남기지 않는다.
10. 유료 반복 실행 전에 provider 지출 한도와 남은 quota를 확인하고 이번 평가의 최대 호출 수를 정한다.

## 연결 적합성 실행 순서

아래 순서를 행렬의 각 셀에서 반복한다.

1. SillyTavern 페이지를 새로고침한다. AI 결과 cache는 메모리 전용이므로 독립 반복 실행 사이에도 새로고침해 이전 결과를 재사용하지 않는다.
2. ST DevTools를 열고 합성 full 스냅샷을 선택한다. AI 모드를 켠 것만으로 snapshot 수, provider 사용량, 화면 결과가 변하지 않는지 확인한다.
3. 검사할 정적 finding 또는 cluster를 수동으로 선택한다. 자동 선택된 대상이 없어야 한다.
4. `AI로 더 자세히 보기`에서 해당 셀의 연결을 선택하고 응답 상한, 추가 지시, prefill을 확인한다.
5. `전송 내용 미리보기`를 연다. 다음을 화면에서 직접 대조한다.
   - provider/model과 현재 연결·프로필 경로가 의도한 셀과 일치한다.
   - 포함 source는 선택 target의 closure에 필요한 합성 원문뿐이다.
   - 제외 source와 이유가 보이며 실제 사용자 원문이 한 글자도 섞이지 않는다.
   - 고정 안전 지시, 사용자 추가 지시, prefill, 입력 추정치, 응답 상한이 정확하다.
   - 동의 체크가 선택되지 않은 상태이고 실행 버튼은 동의 전까지 비활성이다.
6. 먼저 모달을 취소한다. provider 사용량과 AI 결과가 생기지 않았는지 확인한다.
7. 미리보기를 다시 만들고 모든 내용을 다시 확인한다. 동의가 이전 실행에서 유지되지 않았는지 확인한 뒤 이번 1회만 동의하고 실행한다.
8. 성공하면 제안 수, category, severity, source/target 집합과 각 evidence의 source·범위를 기준 corpus와 대조한다. 원문은 기록지에 복사하지 않는다.
9. 실패하면 화면의 안정된 `SEMANTIC_*` code와 bounded reason만 기록한다. provider 원문 오류, 응답 body, request ID를 개발자 도구나 기록지로 옮기지 않는다.
10. 실행 전후 현재 채팅의 스냅샷 수를 비교한다. AI 요청 자체가 일반 요청 스냅샷으로 추가되지 않아야 한다.
11. 캐릭터 카드, 페르소나, preset, 비교 정책과 검토 판정이 실행 전후 동일한지 확인한다.

## 현재 UI에서 가능한 제한적 의미 smoke

연결 적합성을 통과한 셀에서만 수행한다. 이 절차는 provider가 합성 충돌을 유용하게 설명할 수 있는지 살펴보는 smoke이며 corpus release gate 통과 판정이 아니다.

1. 현재 corpus에서 UI로 재현할 합성 양성 사례를 `case.id`로 추적한다. 조건·예외·말투·역할·안전처럼 하위 의미가 다른 사례를 하나의 대표 결과로 합치지 않는다.
2. UI에서 실제 로컬 finding 또는 cluster가 생기고 같은 source closure를 안전하게 선택할 수 있는 사례만 실행한다. 만들 수 없는 사례에 임의의 가짜 finding을 넣지 않는다.
3. UI가 만든 target/source ID는 corpus fixture의 canonical ID와 다를 수 있다. 화면 결과를 `semantic-evaluation.js`에 넣거나 exact ID 적중으로 기록하지 말고, category 방향·선택한 로컬 source 범위·원문에 실제 존재하는 evidence·사람이 읽은 판단 이유만 별도의 `ui-smoke`로 기록한다.
4. 한 번의 실행은 연결·응답 형태 smoke일 뿐 품질 통과가 아니다. 변동을 참고하려면 페이지 새로고침, 새 미리보기, 새 동의를 거쳐 최대 3회 반복하되 비용 한도를 먼저 지킨다.
5. 로컬 finding이 없는 음성 사례는 UI에서 재생하지 못하므로 `blocked-no-harness`로 남긴다. UI 양성 smoke가 성공해도 전체 corpus나 해당 provider family를 `pass`로 승격하지 않는다.

## 공식 harness 이후 전체 corpus 품질 평가

확장과 같은 inspector·adapter·capture gate 인스턴스를 공유하는 공식 in-process harness가 구현된 뒤에만 아래 순서로 전체 품질을 판정한다.

1. canonical corpus v2 request와 target/source ID를 변경 없이 사용하고 각 사례를 독립 실행한다. raw prompt·raw response는 저장하지 않는다.
2. 각 provider/route 셀에서 corpus 전체를 3회 반복한다. 매 반복은 새 inspector 또는 명시적 memory cache 초기화, 새 미리보기와 새 동의를 사용한다.
3. 기대 issue가 있는 사례는 category가 허용 목록 중 하나인지, target ID 집합과 source ID 집합이 정확히 같은지 확인한다. 관련 없는 source를 하나라도 추가하면 적중이 아니다.
4. evidence는 같은 source에서 기대 범위와 intersection-over-union 0.5 이상일 때만 맞은 것으로 센다. quote도 합성 원문의 정확한 slice여야 한다.
5. 기대 issue가 없는 사례의 모든 제안은 false positive다. 그럴듯한 설명이어도 예외로 인정하지 않는다.
6. 집계는 `semantic-evaluation.js`와 동일하게 계산한다.
   - 유용성 = 적중 issue 수 / 기대 issue 수
   - 오탐률 = 매칭되지 않은 제안 수 / 전체 제안 수
   - 근거 정확도 = 맞은 evidence 수 / `max(기대 evidence 수, 반환 evidence 수)`
7. corpus의 `thresholds`와 `releaseGates`를 함께 사용한다. 현재 전체 기준은 유용성 0.8 이상, 오탐률 0.1 이하, 근거 정확도 0.8 이상이다. 이 평균을 넘더라도 조건·예외·말투·역할·안전 각 축의 양성 사례가 exact issue match가 아니거나 기대 근거 pair가 하나라도 빠지거나 추가 근거가 있거나, 음성 사례가 제안 0건이 아니면 실패다.
8. 같은 case ID의 세 결과를 하나의 result map에 합치지 않는다. 세 반복을 각각 평가해 모두 전체 기준과 축별 gate를 통과해야 품질 통과로 기록하고 최악값과 중앙값을 함께 남긴다.

## 개인정보·동의·안전 경계 시험

각 항목은 적어도 현재 연결 경로 1회와 Connection Manager 경로 1회 수행한다. provider family별 envelope 차이는 각 family의 성공 셀에서 확인한다.

### 개인정보 모드

- redacted 스냅샷에서 AI 검사 준비와 실행이 차단되는지 확인한다.
- metadata 스냅샷에서도 동일하게 차단되는지 확인한다.
- full 스냅샷의 preview에 closure 밖 source 원문이 포함되지 않는지 확인한다.

### 동의와 cache

- AI 모드 활성화, target 선택, preview 취소만으로 provider 호출이 없어야 한다.
- 재시도와 cache hit에도 동의 체크는 다시 비어 있어야 한다.
- 모달 닫기, 바깥 영역, Escape, 실행 중 취소 후 결과가 새로 저장되거나 표시되지 않아야 한다.
- 취소 후 즉시 과금이 멎었다고 판단하지 말고 해당 provider 호출이 정리될 시간을 둔 뒤 재시도한다.

### Identity 고정

- 현재 연결 셀에서는 preview를 연 뒤 SillyTavern의 model을 바꾸고 실행한다. 준비 당시 identity와 달라졌으므로 전송 결과를 사용하지 않고 `SEMANTIC_INVALID_INPUT`으로 끝나야 한다.
- 프로필 셀에서는 preview 뒤 프로필의 model/provider가 바뀌거나 프로필이 사라진 상황을 같은 방식으로 확인한다.
- 저장된 프로필이 preview 전에 이미 resolve되지 않으면 현재 연결을 사용할 수 있지만, preview는 반드시 현재 연결 identity를 새로 보여 줘야 한다. 이를 프로필 실행 성공으로 기록하지 않는다.

### 프로필 경로 격리

- 유효한 선택 프로필로 실행할 때 현재 채팅 연결이 바뀌지 않아야 한다.
- 전용 테스트 환경에서 선택 프로필의 요청을 의도적으로 실패시키고 현재 연결은 유효하게 둔다. 프로필 요청이 시작된 뒤 실패한 경우 현재 연결로 두 번째 요청을 보내지 않고 한 번의 안정된 오류로 끝나야 한다.
- 위 시험은 테스트용 거부 프로필이나 quota가 없는 테스트 프로젝트로만 수행한다. 잘못된 credential 문자열을 문서·스크린샷·콘솔에 남기지 않는다.

### 응답 검증과 provider 안전 거부

- 정상 응답은 JSON object 한 개와 정확한 evidence만 결과 카드로 받아들여야 한다.
- 잘린 JSON은 응답 상한을 2,048로 한 번 올려 재시도한다. 다시 실패하면 프롬프트 계약을 느슨하게 만들지 말고 해당 셀을 실패로 기록한다.
- provider의 refusal 또는 safety block은 `SEMANTIC_PROVIDER_ERROR` / `provider-rejected`로 분류되어야 한다. 거부 원문을 결과·저장소·오류 메시지에 노출하지 않는다.
- harmless 합성 안전 사례가 반복해서 거부되면 provider 필터를 우회하도록 문구를 바꾸지 않는다. 사례 문구와 provider 적합성을 별도로 재검토한다.
- 알 수 없는 envelope, 원문에 없는 quote, 잘못된 ID·offset, schema 밖 필드는 전체 응답을 폐기해야 한다. 일부 제안만 살리지 않는다.

## 중단 기준

다음 중 하나라도 발생하면 전체 평가를 즉시 중단하고 보안·개인정보 회귀로 분류한다.

- preview 또는 결과에 합성 fixture가 아닌 실제 사용자 원문이 보인다.
- 동의 전에 provider 호출이 발생하거나 이전 동의가 재사용된다.
- API key, endpoint URL, 비밀번호, raw provider 오류/body, opaque profile ID가 UI·로그·내보내기·평가 기록에 나타난다.
- AI 요청이 일반 채팅 스냅샷으로 저장되거나 기존 스냅샷·프롬프트·정책을 변경한다.
- 선택 프로필 실패 뒤 현재 연결로 자동 재시도한다.
- preview identity와 실제 전송 identity가 달라졌는데도 결과를 받아들인다.
- 원문에 없는 evidence나 알 수 없는 ID가 결과 카드 일부로 통과한다.

다음은 해당 셀만 중단하고 원인을 분류한다.

- 인증: `SEMANTIC_AUTHENTICATION_ERROR` / `provider-authentication`
- 요청 한도: `SEMANTIC_RATE_LIMITED` / `provider-rate-limited`
- 네트워크: `SEMANTIC_NETWORK_ERROR` / `provider-network`
- provider 일시 장애: `SEMANTIC_PROVIDER_UNAVAILABLE` / `provider-unavailable`
- timeout: `SEMANTIC_TIMEOUT` / `provider-timeout`
- 안전 거부·기타 거부: `SEMANTIC_PROVIDER_ERROR` / `provider-rejected`
- 지원 envelope 없음: `SEMANTIC_INVALID_RESPONSE` / `provider-response-shape`

네트워크·일시 장애는 상태가 회복된 뒤 새 preview와 새 동의로 한 번만 재시도한다. 인증·거부·형식 문제는 같은 설정으로 무한 재시도하지 않는다. 월/일 지출 한도, 호출 수 한도 또는 평가자가 정한 시간 한도에 도달하면 성공률과 무관하게 중단한다.

## 기록 양식

원문과 credential을 기록하지 않는 아래 형식을 실행마다 복사해 사용한다.

```text
[평가 세션]
평가 ID:
날짜/평가자:
commit / ST DevTools / SillyTavern / 브라우저:
corpus version / case ID 목록:
자동 테스트: pass | fail
provider family: openai | anthropic | google | compatible
route: current | connection-manager
화면 표시 provider/model:
평가용 프로필 별칭: (opaque ID 기록 금지)
completion type: chat-completion | text-completion
capture mode: full
응답 상한 / sampling 설정:
추가 지시 / prefill: blank | 합성 fixture ID
호출 수 한도 / 비용 한도:

[경계 확인]
AI mode만 켰을 때 호출 없음: pass | fail
preview source 최소 범위: pass | fail
1회 동의 초기화: pass | fail
preview 취소 시 호출 없음: pass | fail
AI self-capture 없음: pass | fail
원본·정책 변경 없음: pass | fail
identity 변경 fail-closed: pass | fail | not-run
프로필 실패 후 current 재시도 없음: pass | fail | not-run
redacted/metadata 차단: pass | fail | not-run

[사례 결과]
case ID / 반복 번호:
실행 상태: ui-smoke | success | empty | stable-error | blocked-no-harness
예상 issue 수 / 반환 suggestion 수 / 적중 수 / 오탐 수:
기대 evidence 수 / 반환 evidence 수 / 정확 evidence 수:
진단 code / bounded reason: (성공이면 none)
지연: 초 또는 구간
특이사항: 원문·quote·request ID 기록 금지

[집계]
유용성 / 오탐률 / 근거 정확도:
축별 release gate 통과 수 / 실패 축:
corpus threshold 통과: pass | fail | incomplete
최종 판정: pass | fail | blocked
미평가 셀과 이유:
```

## 최종 판정 규칙

- `pass`: 자동 테스트, 연결 적합성 경계, 해당 provider/route의 실행 가능한 corpus 품질, threshold를 모두 통과했고 공식 harness가 필요한 사례가 없다.
- `incomplete`: 보안 경계는 통과했지만 공식 harness 부재, provider quota, 공개 Connection Manager API 부재 등으로 하나 이상의 필수 사례나 셀을 평가하지 못했다.
- `fail`: 개인정보·동의·identity·경로 격리·엄격한 응답 검증 중 하나가 실패했거나 corpus threshold를 넘지 못했다.

`incomplete`를 `pass`로 바꾸지 않는다. 특정 model의 통과는 같은 family의 다른 model, 다른 날짜의 model revision, OpenRouter 같은 중계 경로의 품질을 보증하지 않는다.
