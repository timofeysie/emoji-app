# Staging workflow (macOS / zsh)

From `develop` onto staging and then into `main`.
This is the zsh version of README → *Deploy application changes to staging*
(which is written for PowerShell), plus the order of steps.

Staging: <https://emoji-staging.kogs.link>

## How it fits together

- **Terraform runs whatever image `image_uri` pins** in
  `infra/terraform/envs/staging/terraform.tfvars`. `terraform apply` alone never
  deploys new code. You must build and push a new image and change `image_uri`.
- **CI only applies when `infra/terraform/**` changes.** Merging to `main` with
  a new `image_uri` runs `terraform apply` in GitHub Actions. A merge with
  code changes only deploys nothing.
- **Test on staging first, then merge.** Apply from your laptop on `develop`, check
  it works, then open the PR. CI's apply on merge is then a no-op.

## Once per session

```zsh
cd ~/repos/timo/lumpy-space/emoji-app       # repo root
open -a Docker                               # Docker Desktop must be running
aws sts get-caller-identity                  # are AWS credentials still valid?
dig +short SRV _mongodb._tcp.emojicluster.r87poqo.mongodb.net   # is Atlas awake?
```

If `aws sts` fails, log in again (`aws sso login` or refresh your keys).

If `dig` prints nothing, Atlas has paused the free cluster after a quiet
spell. Open cloud.mongodb.com → **EmojiCluster** → **Resume**, and wait until
it shows active. Otherwise the server can't start (see Gotchas).

## 1. Build and push an image

```zsh
# Tag for today. Add a suffix (a, b, c…) if you push more than once a day.
tag="staging-$(date +%F)a"
registry="100641718971.dkr.ecr.ap-southeast-2.amazonaws.com"

# Log in to ECR (once per shell, valid 12 h)
aws ecr get-login-password --region ap-southeast-2 |
  docker login --username AWS --password-stdin "$registry"

# Build for x86 (Fargate runs X86_64; this Mac is arm64, so --platform is required)
docker build --platform linux/amd64 -t "emoji-app:$tag" \
  --build-arg VITE_COGNITO_DOMAIN="https://ap-southeast-2myj579wg2.auth.ap-southeast-2.amazoncognito.com" \
  --build-arg VITE_COGNITO_CLIENT_ID="7d0kjtsi0h8kjhk2fg1ee64h55" \
  --build-arg VITE_COGNITO_SCOPES="openid email profile" \
  .

# Push
docker tag "emoji-app:$tag" "$registry/emoji-app:$tag"
docker push "$registry/emoji-app:$tag"
```

Do **not** pass `VITE_DISABLE_AUTH`. Staging must run with auth on.

After completing the tag, build and push, you can see an output like this:

```sh
...
d38560acd9f5: Pushed 
2b9a8a8577e5: Pushed 
d928336d8f92: Pushed 
staging-2026-11-07a: digest: sha256:7d936c946374ae39008eade50d7f1545b861456c4019d4e1a7475fe4fc1d7785 size: 856
```

## 2. Point Terraform at the new image

```zsh
sed -i '' "s|^image_uri = \".*\"|image_uri = \"$registry/emoji-app:$tag\"|" \
  infra/terraform/envs/staging/terraform.tfvars
grep image_uri infra/terraform/envs/staging/terraform.tfvars   # check it
```

The output from the grep command looks like this:

```sh
timo@Timothys-MacBook-Pro emoji-app % grep image_uri infra/terraform/envs/staging/terraform.tfvars
image_uri = "100641718971.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:staging-2026-11-07a"
```

## 3. Apply from your laptop and test

```zsh
cd infra/terraform/envs/staging
terraform init          # safe to repeat; needed after a long break or provider changes
terraform plan          # expect: task definition replaced, service updated (or everything created after a destroy)
terraform apply         # waits until ECS is healthy, about 3–5 min
cd -
```

Smoke test:

```zsh
curl -sS https://emoji-staging.kogs.link/api/version            # {"version":"<package.json version>"}
curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://emoji-staging.kogs.link/api/badges   # HTTP 200
curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://emoji-staging.kogs.link/api/me       # HTTP 401 (auth is on)
```

If the smoke test returns a 503 error, login to https://cloud.mongodb.com/ and resume the EmojiCluster.

Then run 

```
aws ecs update-service --cluster emoji-staging-cluster --service emoji-staging-service --force-new-deployment --region ap-southeast-2
```

After a few minutes, the smoke test looks like this:

```sh
curl -sS https://emoji-staging.kogs.link/api/version  
{"version":"1.3.0","expectedControllerVersion":"0.8.1","expectedPicoVersion":"0.5.5"}%  
```

In the browser:

- [✅] Signed out: no YALLA or Profile link in the header.
- [✅] Sign in, open Profile → *Practise as*, link a player.
- [✅] Reload `/yalla`: still signed in, and "Practising as …" is shown.
- [✅] Sign out and back in: the link is still there.

Something wrong? Fix it on `develop`, then repeat steps 1–3 with a new tag suffix.

## 4. Commit, PR, merge

```zsh
git add -A
git commit -m "release $tag"
git push origin develop
```

Open a PR `develop → main` on GitHub. The **Terraform (staging)** workflow posts a
plan comment, which should show **no changes** because you already applied. Merge it.
CI then runs `terraform apply`, which also does nothing.

## Staging LRS (one-off)

Staging reads the LRS (Players → detail, YALLA progress, xAPI export) from
one Secrets Manager secret, `emoji-app/staging/xapi-lrs`. Staging and local
dev share the Veracity `dev` store, so build the secret from your `.env`
(nothing is printed):

```zsh
source <(grep '^XAPI_LRS_' .env)
aws secretsmanager create-secret --region ap-southeast-2 \
  --name emoji-app/staging/xapi-lrs \
  --secret-string "$(jq -n --arg e "$XAPI_LRS_ENDPOINT" --arg k "$XAPI_LRS_KEY" --arg s "$XAPI_LRS_SECRET" \
    '{XAPI_LRS_ENDPOINT:$e, XAPI_LRS_KEY:$k, XAPI_LRS_SECRET:$s}')" \
  --query Name
```

Then set `lrs_secret_enabled = true` in
`infra/terraform/envs/staging/terraform.tfvars` and apply (step 3). The plan
shows a new task definition with three more `secrets` entries.

To change the values later, use `put-secret-value` with the same
`--secret-string`, then restart the service (see Gotchas).

## Save money when you're done

```zsh
cd infra/terraform/envs/staging
terraform destroy       # ECS, ALB, security groups, IAM go; ECR images, secrets, DNS zone stay
```

To bring it back later with the image already pinned (no code changes):
`terraform apply` from the same folder.

The Cognito user pool and MongoDB Atlas are **not** managed by Terraform, so
user ids and data survive a destroy.

## Gotchas

| Symptom | Cause / fix |
| --- | --- |
| `docker: command not found` / cannot connect to daemon | Start Docker Desktop. |
| ECS task stops at once with `exec format error` | Image was built for arm64. Rebuild with `--platform linux/amd64`. |
| `apply` says no changes but the old code is live | `image_uri` wasn't updated (step 2). |
| Sign-in redirects fail | Cognito app client callback must include `https://emoji-staging.kogs.link/auth/callback` (see `docs/auth.md`). |
| `terraform init` complains about the backend | Credentials expired. Run `aws sts get-caller-identity` and log in again. |
| LRS features (pills, player progress, Leitner export) say "The LRS is not configured" | `lrs_secret_enabled` is false or the secret is missing. See **Staging LRS** above. |
| 503 from the site for minutes; ECS events say `tasks failed to start`; log shows `querySrv ENOTFOUND _mongodb._tcp.emojicluster…` | Atlas paused the free cluster. Resume it in Atlas, then restart: `aws ecs update-service --cluster emoji-staging-cluster --service emoji-staging-service --force-new-deployment --region ap-southeast-2`. |
| Need to see why a task stopped | `aws logs tail /ecs/emoji-staging-task --since 30m --region ap-southeast-2` |
