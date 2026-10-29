# Korean UI for DeepSeek Harness

Harness의 언어 설정에 **한국어**를 추가하는 외부 언어팩입니다.
지원 버전은 `0.2.1-rc.2`이며, 17개 네임스페이스의 1,176개 항목을 제공합니다.

## 설치

모노레포 루트에서 `pnpm install --frozen-lockfile`을 실행하고 다음으로 패키징하세요.

```sh
pnpm --filter @dungsil/dsh-plugin-locale-ko pack
npx @deepseek-ai/dsh@0.2.1-rc.2 plugin --profile web add /absolute/path/dungsil-dsh-plugin-locale-ko-0.1.0.tgz
```

실제 tarball 경로를 사용하세요. 아직 npm에 게시하지 않았습니다. Harness를 재시작한 뒤
계정 메뉴의 **Settings → General → Language → 한국어**를 선택하세요.
설정을 저장하지 않은 한국어 브라우저(`ko-KR` 포함)는 자동으로 한국어를 선택합니다.
사용자가 이미 지정한 언어는 바꾸지 않습니다.

## 범위와 동작

- 대화, 도구 출력, 작업 공간·세션, 일반·외관·모델·계정·권한 설정, 프리셋, 단축키를 번역합니다.
- 플러그인 관리·마켓, 자동화, 파일 탐색기, 일부 고급 설정은 아직 영어로 표시됩니다.
- 모델의 응답이나 사용자 파일은 번역하지 않습니다. 온보딩 이미지의 텍스트는 영어입니다.
- 미번역 문구는 Harness의 기본 영어 사전으로 대체합니다.
- 언어 선택은 Harness가 저장합니다. 이 플러그인은 별도 저장소나 네트워크 요청을 만들지 않습니다.
- 플러그인을 비활성화하면 한국어와 사전을 해제하고 Harness의 사용 가능한 기본 언어로 돌아갑니다.
- 다시 활성화하면 저장된 한국어 선택을 복원합니다.

전체 Harness UI의 완전 번역이 아닙니다. 다음 버전은 사전 및 API를 확인한 뒤 지원 범위를 갱신합니다.

## 개발

모노레포 루트에서 `pnpm check`, `pnpm dev`를 실행하세요.
`src/ko.json`이 번역 사전이며 `test/en.json`은 버전이 고정된 영어 기준 사전입니다.
키 누락, 추가, 자리표시자 손실과 실제 Cordis/LocaleRuntime의 언어 선택·대체·해제 동작을 검사합니다.

MIT. DeepSeek 원본 사전의 저작권은 함께 배포되는 `NOTICE`를 참고하세요.
