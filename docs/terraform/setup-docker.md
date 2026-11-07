# First-time setup on the Mac (Docker, Terraform, AWS)

One-off setup before following [`workflow.md`](./workflow.md) on this Mac
(Apple M4 Pro, macOS, zsh, Homebrew already installed).

## What this Mac has (checked 2026-11-01)

| Tool | Installed | Needed | Action |
| --- | --- | --- | --- |
| Docker | none | Docker Desktop | **install** |
| Terraform | 1.5.7 | ≥ 1.7.0 (CI uses 1.9.8) | **upgrade** |
| Rosetta 2 | not checked | for building Intel-type (amd64) images | install (one command) |
| AWS CLI | 2.31.37, with `~/.aws` config | ✓ | check sign-in works |
| GitHub CLI `gh` | none | optional | install if you want PRs from the terminal |
| Node | 20.19.5 | 22 per CLAUDE.md | optional; Docker builds use their own Node 22 |

## 1. Docker Desktop (Apple silicon)

```zsh
brew install --cask docker-desktop
open -a Docker        # first launch: accept the terms, let it finish starting
docker version        # shows both a Client and a Server section when it's running
```

```sh
🍺  docker-desktop was successfully installed!
timo@Timothys-MacBook-Pro emoji-app % open -a Docker 
timo@Timothys-MacBook-Pro emoji-app % docker version 
Client:
 Version:           29.9.2
 API version:       1.56
 Go version:        go1.26.10
 Git commit:        a82e528
 Built:             Tue Oct 20 18:43:59 2026
 OS/Arch:           darwin/arm64
 Context:           desktop-linux

Server: Docker Desktop 4.98.0 (245422)
 Engine:
  Version:          29.9.2
  API version:      1.56 (minimum version 1.40)
  Go version:       go1.26.10
  Git commit:       0367cbe
  Built:            Tue Oct 20 18:44:14 2026
  OS/Arch:          linux/arm64
  Experimental:     false
 containerd:
  Version:          v2.4.2
  GitCommit:        b7a25261e029d68978bbf290df0a62fc819b3c51
 runc:
  Version:          1.5.2
  GitCommit:        v1.5.2-0-g29dd3dc2
 docker-init:
  Version:          0.19.0
  GitCommit:        de40ad0
```

## 2. Rosetta

The staging server runs X86_64 (amd64), so images are built with
`--platform linux/amd64`. Rosetta makes that fast on Apple silicon.

```zsh
softwareupdate --install-rosetta --agree-to-license
...
Install of Rosetta 2 finished successfully
```

Then in Docker Desktop, open **Settings → General** and make sure
**"Use Rosetta for x86_64/amd64 emulation on Apple Silicon"** is ticked. It's on
by default in recent versions.

Confirmed Use Rosetta for x86_64/amd64 emulation on Apple Silicon is on.

## 3. Terraform

Homebrew's own Terraform package is stuck at 1.5.7, so install it from
HashiCorp's tap:

```zsh
brew uninstall terraform
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
terraform version     # should show 1.9 or newer
...
timo@Timothys-MacBook-Pro emoji-app % terraform version 
Terraform v1.17.1
on darwin_arm64
```

## 4. Check AWS works

```zsh
aws sts get-caller-identity   # should show account 100641718971
```

If this fails, your credentials from the Windows machine are probably
expired. Create a new access key in IAM, or use `aws sso login`, then run
`aws configure`.

But it didn't fail:

```sh
timo@Timothys-MacBook-Pro emoji-app % aws sts get-caller-identity  
{
    "UserId": "AIDARO3VWYK56AMBHS4DF",
    "Account": "100641718971",
    "Arn": "arn:aws:iam::100641718971:user/cdk-user"
}
```

## 5. Optional

```zsh
brew install gh && gh auth login     # opening PRs from the terminal
brew install node@22                 # match the Node version in CLAUDE.md for local dev
```

## 6. Check that the build works

From the repo root, before trying the full deploy:

```zsh
docker build --platform linux/amd64 -t emoji-app:test .
```

If it finishes, you're ready for [`workflow.md`](./workflow.md).

```sh
...
 => exporting to image                                                           1.1s
 => => exporting layers                                                          1.1s
 => => exporting manifest sha256:4c0e396c7d4311fa1046696754051520f6cec2bf74cf80  0.0s
 => => exporting config sha256:2228adff37403ea2395270bfb51a067a035bcdd8c1da1cbc  0.0s
 => => exporting attestation manifest sha256:18f20b0886c587b30692bcec459b34a643  0.0s
 => => exporting manifest list sha256:c26a7be2e6dfe7666c54fe8659f4f221d6b944def  0.0s
 => => naming to docker.io/library/emoji-app:test                                0.0s

 2 warnings found (use docker --debug to expand):
 - SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions for sensitive data (ARG "VITE_DISABLE_AUTH") (line 12)
 - SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions for sensitive data (ENV "VITE_DISABLE_AUTH") (line 13)
```
