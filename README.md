# dsh-plugins

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)용 플러그인 모노레포입니다.
`packages/*`를 독립 패키지로 관리하며 루트의 pnpm workspace에서 빌드와 검증을 실행합니다.

## 플러그인

| 패키지                                                        | 역할                    | 검증 대상        |
| ------------------------------------------------------------- | ----------------------- | ---------------- |
| [@dungsil/dsh-plugin-locale-ko](packages/locale-ko/README.md) | 주요 UI의 한국어 언어팩 | DSH `0.2.1-rc.2` |

한국어 언어팩은 17개 네임스페이스의 1,176개 항목을 제공합니다. 공통 버튼, 대화와 도구 출력,
작업 공간·세션, 일반·모델·계정·권한 설정, 에이전트 프리셋, 단축키를 포함합니다.
**Harness 전체 및 모든 플러그인의 완전 번역은 아닙니다.** 플러그인 관리·마켓, 자동화,
파일 탐색기와 일부 고급 설정 등 아직 다루지 않은 영역은 영어로 표시됩니다.
모델의 응답, 사용자 콘텐츠, 다른 패키지의 메타데이터, 이미지 내부 문구는 번역하지 않습니다.

데스크톱 브라우저에서 검증했습니다. 390px 너비에서는 업스트림 설정 창의 고정 사이드바 때문에
영어와 한국어 모두 본문이 잘리거나 과도하게 줄바꿈됩니다. 이 언어팩은 Host 레이아웃을
변경하지 않으므로 좁은 화면의 설정 창은 아직 지원하지 않습니다.

## 시작하기

개발 도구는 `package.json`의 pnpm 12.16.1과 Node.js 26.13.0을 사용합니다.
pnpm의 `devEngines` 설정이 지정된 런타임을 설치하며, 패키지 스크립트는 해당 Node.js로 실행됩니다.
배포된 언어팩의 실행 요구 사항은 별도로 Node.js 24.9 이상입니다.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

`pnpm dev`는 빌드한 플러그인을 로컬 Harness의 web 프로필에 설치하고 실행합니다.
설정과 데이터는 저장소의 `.dsh-dev/`에 격리하며 기존 `~/.dsh`는 수정하지 않습니다.
CLI에 표시되는 인증 URL을 브라우저에서 열고, 첫 안내를 닫은 뒤 계정 메뉴의
**Settings → General → Language → 한국어**를 선택하세요.
UI 확인에는 API 키가 필요하지 않으며 실제 모델 호출에는 별도 인증이 필요합니다.

번역을 수정한 뒤에는 개발 서버를 종료하고 `pnpm dev`를 다시 실행하세요.
`pnpm dev -- --port 3081`처럼 `--` 뒤에 Harness Web CLI 옵션을 전달할 수 있습니다.
개발 환경의 제품 텔레메트리는 비활성화합니다.

## 설치용 파일 만들기

```sh
pnpm --filter @dungsil/dsh-plugin-locale-ko pack
```

루트에 생성된 `dungsil-dsh-plugin-locale-ko-0.1.0.tgz`를
Harness가 실행되는 컴퓨터로 옮긴 뒤 설치합니다.

```sh
npx @deepseek-ai/dsh@0.2.1-rc.2 plugin --profile web add /absolute/path/dungsil-dsh-plugin-locale-ko-0.1.0.tgz
npx @deepseek-ai/dsh@0.2.1-rc.2 web
```

`/absolute/path`를 실제 경로로 바꾸세요. 실행 중인 Harness는 설치 후 재시작하세요.
아직 npm에 게시하지 않았으므로 패키지 이름만으로 설치할 수는 없습니다.

## 모노레포 작업 규칙

- `packages/<plugin>/package.json`: 독립 이름·버전, 공개 `exports`, `files`, `engines.dsh`, `dsh.bundle`.
- `src/index.ts`: Host 진입점. `src/client.ts`: 브라우저 플러그인 진입점.
- `cordis.patch.yml`: 패키지 자체를 등록하는 번들 패치.
- `locale/en.json`, `locale/ko.json`: 플러그인 관리자에 표시할 패키지 메타데이터.
- `scripts/build.mjs`: Host ESM과 Harness ModuleLoader용 브라우저 번들을 생성합니다.
- `tools/tsconfig`: 패키지에서 `@dungsil/dsh-tsconfig`로 상속하는 공통 TypeScript 설정.
- `turbo.json`: 빌드·타입 검사·테스트의 실행 순서와 캐시를 관리합니다. 테스트와 개발 서버는 빌드 후 실행됩니다.
- `pnpm check`: Oxfmt 포맷 검사, 타입 인식 Oxlint, TypeScript 검사, 빌드와 패키지별 테스트를 실행합니다.
- `pnpm format`: 기존 `.oxfmtrc.json` 규칙으로 포맷을 적용합니다. Prettier는 사용하지 않습니다.
- `.github/workflows/ci.yml`: 같은 검증과 패키징을 GitHub push/PR에서 실행합니다.
- `.agents/setup`: 새 Amp orb에서 잠금 파일대로 의존성을 설치하고 빌드합니다.

새 플러그인은 `packages/` 아래에 추가하고 위 계약을 따르세요. 루트는 비공개이며 각 플러그인을
별도로 버전 관리·배포합니다. 클라이언트에서 Host 서비스를 번들로 가져오지 말고 Cordis의
`inject`와 `ctx`를 사용하세요. 언어팩은 실행 시 추가 라이브러리를 설치하지 않습니다.

## 번역 유지보수

원본 버전·커밋·네임스페이스 경로는 `packages/locale-ko/upstream.json`에 기록합니다.
`test/en.json`은 해당 커밋에서 추출한 영어 기준 사전이며 CI는 네트워크 없이 이를 검사합니다.
업스트림 버전을 바꾸려면 해당 체크아웃의 의존성을 설치한 뒤 다음 명령으로 기준을 갱신하세요.

```sh
pnpm exec node scripts/snapshot-upstream.mjs /absolute/path/to/deepseek-harness
```

이 명령은 지정한 체크아웃의 TypeScript 사전 모듈을 실행하므로 신뢰하는 체크아웃에만 사용하세요.
기록된 커밋과 다르면 실행을 거부합니다. 이후 한국어 키·자리표시자를 맞추고, 의존성과
`engines.dsh`를 함께 갱신한 뒤 실제 UI에서 언어 전환·재시작·비활성화를 검증하세요.
현재는 검증하지 않은 다음 버전의 설치를 허용하지 않습니다.

번역 원칙: 세션 / 작업 공간 / 공급자 / 하위 에이전트 용어를 일관되게 쓰고,
`{name}` 같은 자리표시자와 `/compact`, API 필드 이름은 유지합니다.
K/M은 원본의 수치 단위를 유지하며 ‘천/백만’으로 단순 치환하지 않습니다.
온보딩 이미지의 언어 식별자는 존재하는 리소스인 `en`을 유지합니다.

## 플러그인 마켓

각 패키지는 공식 설치기가 요구하는 `dsh.bundle.patch`, `dsh.client`, 공개 메타데이터를 제공합니다.
[공식 마켓 안내](https://deepseek-harness.github.io/deepseek-harness/en/guide/plugin-market)에 따라
npm 게시 후 패키지 이름을 reference generator에 전달하여 마켓 JSON을 생성할 수 있습니다.
마켓 게시와 npm 배포는 자동으로 수행하지 않으며, 존재하지 않는 배포 버전을 인덱스에 넣지 않습니다.
Git 모노레포의 하위 경로 설치도 Harness가 지원하지만, 이 저장소는 빌드 결과를 커밋하지 않으므로
현재는 **빌드된 tarball 설치**를 사용하세요.

참고: [플러그인 시작하기](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/),
[언어팩 API](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2/packages/client/locale).

## 라이선스

MIT. 번역의 원본 및 영어 기준 사전의 저작권 고지는 [NOTICE](packages/locale-ko/NOTICE)에 있습니다.
