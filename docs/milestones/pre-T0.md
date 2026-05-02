# Pre-T0 Work

Pre-flight checks and reference values to collect before starting Terraform
Milestone T0. Nothing here creates AWS resources; we're only installing local
tooling and recording IDs we'll plug into Terraform later.

## Table of contents

- [Tooling install](#tooling-install)
- [AWS CLI prerequisites](#aws-cli-prerequisites)
- [Reference values for later milestones](#reference-values-for-later-milestones)
- [Resolved follow-ups and discovered gaps](#resolved-follow-ups-and-discovered-gaps)
- [Appendix: raw verification output](#appendix-raw-verification-output)

## Tooling install

### Terraform (Windows)

Recommended install path on Windows (one of the following):

1. **winget (preferred, no admin shell tricks needed):**

   ```powershell
   winget install --id Hashicorp.Terraform -e --source winget
   ```

   Note: the winget package ID is case-sensitive with `-e`. It's
   `Hashicorp.Terraform` (lowercase `ashicorp`), not `HashiCorp.Terraform`.
   If you see `No package found matching input criteria`, run
   `winget search terraform` to confirm the exact ID.

2. **Chocolatey (if you already use it):**

   ```powershell
   choco install terraform -y
   ```

3. **Manual zip install (most explicit, useful when behind corp proxy):**
   - Download Windows AMD64 zip from
     <https://developer.hashicorp.com/terraform/install>.
   - Extract `terraform.exe` to a stable location, e.g.
     `C:\tools\terraform\`.
   - Add that folder to the user `PATH` (System Properties ->
     Environment Variables -> Path).

### Verify Terraform install

In a **new** PowerShell window (so PATH refreshes):

```powershell
terraform -version
```

Expected output (version may differ):

```text
Terraform v1.x.y
on windows_amd64
```

If `terraform` is not recognized, the install location isn't on PATH yet.
Restart the shell, or open a new VS Code terminal.

### Optional: shell completion for Terraform

```powershell
terraform -install-autocomplete
```

## AWS CLI prerequisites

Already verified on this laptop. Commands and outputs are in the
[Appendix](#appendix-raw-verification-output).

Summary of the local AWS context:

- AWS CLI `aws-cli/2.17.4` is installed.
- Caller identity resolves to `arn:aws:iam::100641718971:user/cdk-user`.
- Default region (inferred from existing resource ARNs): `ap-southeast-2`.

If the AWS CLI default region isn't already set, configure it once:

```powershell
aws configure set region ap-southeast-2
```

## Reference values for later milestones

These values are pulled from the actual staging account on this machine and
should be used verbatim during Terraform import steps.

### Account and region

| Item | Value | Used in |
| --- | --- | --- |
| AWS account ID | `100641718971` | T1 backend bucket name, T8 OIDC role trust |
| AWS region | `ap-southeast-2` | T1 backend, all `provider "aws"` blocks |
| Local IAM principal | `arn:aws:iam::100641718971:user/cdk-user` | running `terraform plan/apply` from laptop |

### Existing resources to import in Terraform

| Resource | Actual AWS name | ID / ARN | Imported in |
| --- | --- | --- | --- |
| Security group (ECS app) | `emoji-staging-ecs-sg` | `sg-09e4348dc1fc9ee08` | T2 |
| Security group (ALB) | `emoji-staging-alb-sg` | `sg-08de63fa9f296d649` | T2 |
| ALB | `emoji-load-balancer` | `arn:aws:elasticloadbalancing:ap-southeast-2:100641718971:loadbalancer/app/emoji-load-balancer/5320cebe2e987bb7` | T3 |
| ALB DNS | n/a | `emoji-load-balancer-28533277.ap-southeast-2.elb.amazonaws.com` | T3 (output) |
| Target group | `emoji-staging-tg` | `arn:aws:elasticloadbalancing:ap-southeast-2:100641718971:targetgroup/emoji-staging-tg/46cf6b8cb3c5df66` | T3 |
| ALB HTTP:80 listener | n/a | `arn:aws:elasticloadbalancing:ap-southeast-2:100641718971:listener/app/emoji-load-balancer/5320cebe2e987bb7/2b06791ef4473d64` | T3 |
| IAM role (execution) | `emoji-staging-ecs-execution-role` | `arn:aws:iam::100641718971:role/emoji-staging-ecs-execution-role` | T4 |
| IAM role (task) | `emoji-staging-ecs-task-role` | `arn:aws:iam::100641718971:role/emoji-staging-ecs-task-role` | T4 |
| Inline policy on task role | `emoji-staging-read-secrets` | composite import id `emoji-staging-ecs-task-role:emoji-staging-read-secrets` | T4 |

Note: the ALB's actual AWS name is `emoji-load-balancer`, not `emoji-staging-alb`
as written throughout `terraform-milestones.md`. We'll adopt the existing name
in Terraform (ALB names cannot be renamed in place; renaming would require
destroy + recreate, which is unnecessary disruption for a prototype). The
Terraform resource label can still be `aws_lb.app` for clarity even though
`name = "emoji-load-balancer"`.

### Existing resources referenced (not imported)

These are read via Terraform `data` sources, not managed by Terraform.

| Resource | Actual AWS name | ID / ARN | Used in |
| --- | --- | --- | --- |
| Secrets Manager secret (Mongo) | `emoji-app/staging/mongodb-uri` | `arn:aws:secretsmanager:ap-southeast-2:100641718971:secret:emoji-app/staging/mongodb-uri-1zfIGT` | T4 (IAM scope), T5 (task def secret) |
| ECR repository | `emoji-app` | `100641718971.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app` | T5 (task def image) |
| Pinned image for staging | `emoji-app:staging-2026-04-27` | digest `sha256:08347c0e4220461bb279ea7a9f8ddc91bc396f1aa691c44076bad15381572374` | T5 (`var.image_uri`) |
| Mutable convenience tag | `emoji-app:latest` | digest `sha256:ca33d43f00b214658bf1981dfcc56e42769913ebddf89f2ab8844adc655d2f6d` | local/dev only; not used by Terraform |
| Default VPC | n/a | discovered via `data "aws_vpc" "default"` | T2, T6 |
| Default subnets | n/a | discovered via `data "aws_subnets" "default"` | T2, T6 |

Note on the two image digests: the `staging-2026-04-27` tag was created by
re-pushing the existing manifest through PowerShell's `--output text`, which
collapsed whitespace and produced a new manifest digest. The underlying
config blob and layer digests are byte-identical to the original `:latest`
image, so at runtime ECS pulls the same content. Layers are deduplicated in
ECR, so this costs no extra storage. The full `var.image_uri` value to use in
T5 is:

```text
100641718971.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:staging-2026-04-27
```

## Resolved follow-ups and discovered gaps

All four discovery commands have been run. The reference tables above are
current. The discovery surfaced a few decisions that need to be made before or
during the relevant later milestones; none of them block T0.

### Resolved

1. **ALB found under a different name.** The actual ALB is `emoji-load-balancer`,
   not `emoji-staging-alb`. Decision: keep the existing name in AWS and
   adopt it as-is in Terraform (no rename). `terraform-milestones.md` references
   to `emoji-staging-alb` should be treated as logical-only; the AWS `name`
   attribute is `emoji-load-balancer`.
2. **HTTP:80 listener ARN captured.** Recorded in the import table. There is
   only one listener; HTTPS will be added in T7.
3. **ECR repository and image confirmed.** Repo is `emoji-app`; the only
   tagged image is `:latest` (pushed 2026-04-27). The two earlier pushes are
   untagged and can be ignored or cleaned up later.
4. **Image pinning strategy chosen.** Re-tagged the current `:latest` image
   with the immutable tag `staging-2026-04-27` so Terraform has a stable
   `var.image_uri` to reference. CI in T8 will switch to digest pinning.
   Procedure used:
   - `aws ecr batch-get-image` to retrieve the existing manifest by digest.
   - Wrote the manifest to a temp file (avoiding PowerShell argument
     splitting on the JSON body).
   - `aws ecr put-image --image-tag staging-2026-04-27 --image-manifest file://...`.

   Outcome: two image records now coexist in ECR with byte-identical layers
   but different manifest digests (one tagged `:latest`, one tagged
   `:staging-2026-04-27`). This is harmless for our purposes.

### Gaps to resolve

1. **No OpenAI secret in Secrets Manager.** `list-secrets` returned only
   `emoji-app/staging/mongodb-uri`. The Terraform task definition snippet in
   `terraform-milestones.md` references `data.aws_secretsmanager_secret.openai_api_key`,
   which would fail until a secret exists. Three options:
   - Create `emoji-app/staging/openai-api-key` in Secrets Manager (manual,
     same pattern as the Mongo URI). Preferred for parity with prod.
   - Pass `OPENAI_API_KEY` as a plain env var on the task definition. Easiest,
     but mixes secret material with non-secret config.
   - Omit `OPENAI_API_KEY` from the staging task definition entirely. The
     AI chat panel degrades, but core game flow still works.

   Recommendation: pick option 1 before T5. We can do it via Terraform later
   in a hardening pass; for now, creating it once via the console is fine.

2. **Untagged ECR images.** Two of the three recent images have no tag. Worth
   adding an ECR lifecycle policy to prune untagged images, but that's a
   nice-to-have, not a pre-T0 blocker.

### Status

Pre-T0 is **complete**. All local tooling works, all reference IDs are
captured, and the gaps above are tracked. Next step is Terraform Milestone T0
(repo skeleton in `infra/terraform/`).

## Appendix: raw verification output

Captured from this workstation across two sessions on 2026-05-02.

### First pass: AWS identity and known resources

```shell
PS C:\Users\timof\repos\timo\emoji-app> aws --version
aws-cli/2.17.4 Python/3.11.8 Windows/10 exe/AMD64
PS C:\Users\timof\repos\timo\emoji-app> aws sts get-caller-identity
{
    "UserId": "AIDARO3VWYK56AMBHS4DF",
    "Account": "100641718971",
    "Arn": "arn:aws:iam::100641718971:user/cdk-user"
}

PS C:\Users\timof\repos\timo\emoji-app> aws ec2 describe-security-groups --filters "Name=group-name,Values=emoji-staging-*" --query "SecurityGroups[].{Name:GroupName,Id:GroupId}"
[
    {
        "Name": "emoji-staging-ecs-sg",
        "Id": "sg-09e4348dc1fc9ee08"
    },
    {
        "Name": "emoji-staging-alb-sg",
        "Id": "sg-08de63fa9f296d649"
    }
]

PS C:\Users\timof\repos\timo\emoji-app> aws elbv2 describe-load-balancers --names emoji-staging-alb --query "LoadBalancers[].LoadBalancerArn"

An error occurred (LoadBalancerNotFound) when calling the DescribeLoadBalancers operation: Load balancers '[emoji-staging-alb]' not found
PS C:\Users\timof\repos\timo\emoji-app> aws elbv2 describe-target-groups --names emoji-staging-tg --query "TargetGroups[].TargetGroupArn"
[
    "arn:aws:elasticloadbalancing:ap-southeast-2:100641718971:targetgroup/emoji-staging-tg/46cf6b8cb3c5df66"
]

PS C:\Users\timof\repos\timo\emoji-app> aws iam get-role --role-name emoji-staging-ecs-execution-role --query "Role.Arn"
"arn:aws:iam::100641718971:role/emoji-staging-ecs-execution-role"

PS C:\Users\timof\repos\timo\emoji-app> aws iam get-role --role-name emoji-staging-ecs-task-role --query "Role.Arn"
"arn:aws:iam::100641718971:role/emoji-staging-ecs-task-role"

PS C:\Users\timof\repos\timo\emoji-app> aws secretsmanager describe-secret --secret-id emoji-app/staging/mongodb-uri --query "ARN"
"arn:aws:secretsmanager:ap-southeast-2:100641718971:secret:emoji-app/staging/mongodb-uri-1zfIGT"
```

### Second pass: Terraform install and follow-up discovery

```shell
PS C:\Users\timof> terraform --version
Terraform v1.15.1
on windows_amd64

PS C:\Users\timof> aws elbv2 describe-load-balancers --query "LoadBalancers[].{Name:LoadBalancerName,Arn:LoadBalancerArn,Type:Type,Scheme:Scheme,DNS:DNSName}"
[
    {
        "Name": "emoji-load-balancer",
        "Arn": "arn:aws:elasticloadbalancing:ap-southeast-2:100641718971:loadbalancer/app/emoji-load-balancer/5320cebe2e987bb7",
        "Type": "application",
        "Scheme": "internet-facing",
        "DNS": "emoji-load-balancer-28533277.ap-southeast-2.elb.amazonaws.com"
    }
]

PS C:\Users\timof> $albArn = "arn:aws:elasticloadbalancing:ap-southeast-2:100641718971:loadbalancer/app/emoji-load-balancer/5320cebe2e987bb7"
PS C:\Users\timof> aws elbv2 describe-listeners --load-balancer-arn $albArn --query "Listeners[].{Port:Port,Protocol:Protocol,Arn:ListenerArn}"
[
    {
        "Port": 80,
        "Protocol": "HTTP",
        "Arn": "arn:aws:elasticloadbalancing:ap-southeast-2:100641718971:listener/app/emoji-load-balancer/5320cebe2e987bb7/2b06791ef4473d64"
    }
]

PS C:\Users\timof> aws secretsmanager list-secrets --query "SecretList[?starts_with(Name, 'emoji-app/staging/')].{Name:Name,Arn:ARN}"
[
    {
        "Name": "emoji-app/staging/mongodb-uri",
        "Arn": "arn:aws:secretsmanager:ap-southeast-2:100641718971:secret:emoji-app/staging/mongodb-uri-1zfIGT"
    }
]

PS C:\Users\timof> aws ecr describe-repositories --query "repositories[?contains(repositoryName, 'emoji')].{Name:repositoryName,Uri:repositoryUri}"
[
    {
        "Name": "emoji-app",
        "Uri": "100641718971.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app"
    }
]

PS C:\Users\timof> $repo = "emoji-app"
PS C:\Users\timof> aws ecr describe-images --repository-name $repo --query "sort_by(imageDetails, &imagePushedAt)[-3:].{Tags:imageTags,Pushed:imagePushedAt,Digest:imageDigest}"
[
    {
        "Tags": null,
        "Pushed": "2026-04-05T13:16:35.128000+10:00",
        "Digest": "sha256:b5791d9744d7444e0fb1015a71de6b12140206f331d079655674735a0101d648"
    },
    {
        "Tags": null,
        "Pushed": "2026-04-26T15:11:33.669000+10:00",
        "Digest": "sha256:aeb6a3c22fae12a34790f6258c93c964e4b40d6d60f5d3ecdc26e6d5a61cec1f"
    },
    {
        "Tags": [
            "latest"
        ],
        "Pushed": "2026-04-27T11:59:08.311000+10:00",
        "Digest": "sha256:ca33d43f00b214658bf1981dfcc56e42769913ebddf89f2ab8844adc655d2f6d"
    }
]
```

### Third pass: re-tag for immutable image pinning

```shell
PS C:\Users\timof> $digest = "sha256:ca33d43f00b214658bf1981dfcc56e42769913ebddf89f2ab8844adc655d2f6d"
PS C:\Users\timof> $manifestFile = Join-Path $env:TEMP "emoji-app-manifest.json"

PS C:\Users\timof> aws ecr batch-get-image `
>>   --repository-name emoji-app `
>>   --image-ids imageDigest=$digest `
>>   --query "images[0].imageManifest" `
>>   --output text | Out-File -FilePath $manifestFile -Encoding ascii -NoNewline

PS C:\Users\timof> aws ecr put-image `
>>   --repository-name emoji-app `
>>   --image-tag staging-2026-04-27 `
>>   --image-manifest "file://$manifestFile"
{
    "image": {
        "registryId": "100641718971",
        "repositoryName": "emoji-app",
        "imageId": {
            "imageDigest": "sha256:08347c0e4220461bb279ea7a9f8ddc91bc396f1aa691c44076bad15381572374",
            "imageTag": "staging-2026-04-27"
        },
        "imageManifestMediaType": "application/vnd.docker.distribution.manifest.v2+json"
    }
}
```

The new manifest digest (`08347c0e...`) differs from the original
(`ca33d43f...`) because PowerShell's `--output text` collapsed JSON whitespace
before the manifest was re-uploaded. Both image records reference the same
underlying config blob and layer digests, so runtime behavior is identical
and ECR's layer dedup means no extra storage cost.
