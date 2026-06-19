# claude-memory — Claude Code 메모리 공유본

PronunFit 프로젝트의 **Claude Code 자동 메모리(auto-memory)** 를 여러 로컬에서 공유하기 위한 복사본입니다.

- 원본 위치(로컬, git 미추적): `~/.claude/projects/c--Projects-multi-translator/memory/`
- 진입점: [MEMORY.md](MEMORY.md) — 토픽 파일 인덱스

## ⚠️ 비밀 포함 파일은 공유 제외됨

비밀(keystore PW·API 키·웹훅 토큰 등)이 들어있던 파일은 **마스킹이 아니라 공유에서 통째로 제외**했습니다.
따라서 이 폴더에는 비밀 평문이 없습니다(검증 완료). 단, 그만큼 일부 파일은 누락되어 있습니다.

**제외된 파일(라이브 메모리에만 존재):**
`capacitor-android.md`, `subscription.md`, `changes-0322-session2.md`, `changes-0401.md`,
`changes-0406.md`, `changes-0424-session2.md`, `changes-0330-session2.md`, `changes-0423.md`,
`changes-0508.md`, `changes-0509.md`, `feedback_deploy.md`, `secret-hygiene.md`
+ `MEMORY.md`는 `Facebook/Meta 자격증명` 블록만 제거하고 공유.

> MEMORY.md 인덱스에 위 파일 링크가 남아있을 수 있으나, 공유본에는 그 파일이 없습니다(의도된 누락).

## 다른 로컬에서 사용하는 법

1. 이 repo를 동일 경로(`c:\Projects\multi-translator`)에 clone
2. 이 폴더의 `.md`를 그 기기의 라이브 메모리로 복사(`_README.md` 제외):
   ```bash
   cp claude-memory/*.md "~/.claude/projects/c--Projects-multi-translator/memory/"
   ```
3. 제외된 파일·자격증명 실값이 필요하면 원본 기기의 라이브 메모리에서 별도 전달

## 갱신(push)

메모리가 바뀌면 라이브 → 이 폴더로 복사(비밀 파일 제외) 후 커밋.
앱 코드와 같은 repo이므로 **`git push` 한 번에 함께 올라갑니다.**
