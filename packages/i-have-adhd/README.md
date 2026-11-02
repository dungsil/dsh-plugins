# @dungsil/dsh-plugin-i-have-adhd

[i-have-adhd](https://github.com/ayghri/i-have-adhd)의 ADHD 친화적 응답 규칙을 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)에 제공하는 플러그인입니다. DSH `0.2.1-rc.5` 이상이 필요합니다.

## 설치

아직 npm에 게시하지 않았다면 이 저장소에서 빌드한 패키지를 설치합니다.

```sh
pnpm install --frozen-lockfile
pnpm --filter @dungsil/dsh-plugin-i-have-adhd pack --pack-destination /tmp
dsh plugin --profile web add @dungsil/dsh-plugin-i-have-adhd@file:/tmp/dungsil-dsh-plugin-i-have-adhd-0.1.0.tgz
```

DSH를 다시 시작하면 해당 profile의 모든 대화에 ADHD 모드가 자동 적용됩니다. `/i-have-adhd`를 호출하거나 별도의 플래그를 설정할 필요가 없습니다. `web` 대신 사용하는 profile 이름을 지정할 수 있습니다. npm 게시 후에는 다음 명령으로 설치할 수 있습니다.

```sh
dsh plugin --profile web add @dungsil/dsh-plugin-i-have-adhd
```

## 사용

플러그인이 활성화된 동안 원본의 10개 규칙과 예외 지침을 매 모델 요청의 시스템 프롬프트에 자동으로 포함합니다. 대화 기록과 별도로 등록하므로 컨텍스트 압축으로 이전 스킬 호출이 사라져도 규칙을 다시 호출할 필요가 없습니다.

- 답변이나 다음 행동을 먼저 제시하고, 여러 단계는 번호로 나눕니다.
- 진행 상황과 완료한 작업을 명시하고, 시간은 구체적인 단위로 표현합니다.
- 관련 없는 주제와 불필요한 서두·맺음말을 줄이고, 긴 목록은 묶어서 제시합니다.
- 오류의 위치·원인·해결책을 담백하게 설명하고, 미완료 작업에는 작은 다음 행동 하나를 제시합니다.

원본의 `stop adhd mode` 및 `normal mode` 종료 지침도 그대로 포함합니다. 이는 모델이 따르는 대화 지침이며, 플러그인이 세션별 활성 상태를 저장하거나 주입을 중단하는 기능은 아닙니다. 종료 요청이 컨텍스트 압축으로 사라지면 자동 주입된 규칙이 다시 적용될 수 있습니다. 다시 적용하고 싶을 때 사용할 수 있도록 `/i-have-adhd` 스킬도 유지합니다. 응답 언어는 바꾸지 않습니다.

## 구현 방식과 한계

OpenCode의 always-on 시스템 프롬프트 주입 방식과 네이티브 스킬 등록 방식을 참고했습니다. 패키지의 `skills/` 디렉터리를 DSH 기본 로더인 `@deepseek-ai/dsh-skill-filesystem`에 bundled 스킬 경로로 연결합니다. 파일 읽기, YAML 메타데이터 파싱, 호출 정책 해석은 DSH가 담당합니다. 플러그인 자체에는 YAML 파서나 `yaml` 직접 의존성이 없으며, DSH 로더 내부의 전이 의존성은 유지됩니다.

`ctx.skills.get()`으로 DSH가 읽은 본문을 가져와 `ctx.systemPrompt.section()`에 등록하므로 매 요청에 자동으로 포함됩니다. 기존 시스템 프롬프트는 덮어쓰지 않고, 규칙 본문에는 프롬프트 변수 치환을 적용하지 않습니다. 단, DSH의 `complete` 시스템 프롬프트를 지정한 구성은 DSH 정책에 따라 추가 섹션을 제외합니다.

원본의 `disable-model-invocation: true`는 DSH 로더가 해석하므로 모델의 중복 스킬 호출은 차단됩니다. 이 호출 정책은 시스템 프롬프트 자동 주입과 별개입니다. 별도의 provider 이름을 사용해 기존 파일시스템 스킬 로더와 공존하며, 플러그인을 해제하면 프롬프트 섹션과 bundled 스킬 provider가 함께 해제됩니다.

Pi의 상태 표시·세션 상태 저장이나 별도의 `/i-have-adhd on|off` 명령은 구현하지 않습니다. 항상 꺼 두려면 플러그인을 비활성화하거나 제거합니다. 이미 스킬 호출로 대화에 전달한 지침은 플러그인을 제거해도 남을 수 있으므로, 완전히 초기화하려면 새 대화를 시작합니다.

## 제거

```sh
dsh plugin --profile web remove @dungsil/dsh-plugin-i-have-adhd
```

## 원본 및 라이선스

원본 규칙은 [리비전 `1ecea1993b7fce257ffbd686c070948b5e07eda6`](https://github.com/ayghri/i-have-adhd/commit/1ecea1993b7fce257ffbd686c070948b5e07eda6)의 `skills/i-have-adhd/SKILL.md`를 변경 없이 포함합니다. 네트워크 다운로드나 원본 자동 업데이트는 수행하지 않습니다. MIT 라이선스와 원저작자 표기는 `LICENSE` 및 `NOTICE`에 보존했습니다.
