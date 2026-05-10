# Error acquiring the state lock

```PS C:\Users\timof\repos\timo\emoji-app\infra\terraform\envs\staging> terraform plan
╷
│ Warning: Deprecated Parameter
│
│ The parameter "dynamodb_table" is deprecated. Use parameter "use_lockfile" instead.
╵
╷
│ Error: Error acquiring the state lock
│
│ Error message: operation error DynamoDB: PutItem, https response error StatusCode: 400, RequestID:
│ O65HU3VRN1PSTIMEBMKMM079B3VV4KQNSO5AEMVJF66Q9ASUAAJG, ConditionalCheckFailedException: The conditional request failed
│ Lock Info:
│   ID:        cf1e93bc-3703-54c9-8da9-77a45a150fe9
│   Path:      emoji-app-tfstate-100641718971-ap-southeast-2/staging/terraform.tfstate
│   Operation: OperationTypeApply
│   Who:       BOOK-ANH52UMLGO\timof@BOOK-ANH52UMLGO
│   Version:   1.15.1
│   Created:   2026-05-03 11:10:31.6358447 +0000 UTC
│   Info:
│
│ Terraform acquires a state lock to protect the state from being written
│ by multiple users at the same time. Please resolve the issue above and try
│ again. For most commands, you can disable locking with the "-lock=false"
│ flag, but this is not recommended.```

```sh
cd /d c:\Users\timof\repos\timo\emoji-app\infra\terraform\envs\staging
```

```sh
Set-Location c:\Users\timof\repos\timo\emoji-app\infra\terraform\envs\staging
```

```sh
Do you really want to force-unlock?
  Terraform will remove the lock on the remote state.
  This will allow local Terraform commands to modify this state, even though it
  may still be in use. Only 'yes' will be accepted to confirm.

  Enter a value: yes

Terraform state has been successfully unlocked!

The state has been unlocked, and Terraform commands should now be able to
obtain a new lock on the remote state.
```

Then we can proceed:

```sh
terraform plan
...
Plan: 4 to add, 1 to change, 0 to destroy.

Changes to Outputs:
  + acm_certificate_arn      = (known after apply)
  + staging_app_url          = "https://emoji-staging.kogs.link"
╷
│ Error: Invalid count argument
│
│   on ..\..\modules\alb\main.tf line 55, in resource "aws_lb_listener" "https":
│   55:   count = var.acm_certificate_arn != "" ? 1 : 0
│
│ The "count" value depends on resource attributes that cannot be determined until apply, so  
│ Terraform cannot predict how many instances will be created. To work around this, use the   
│ -target argument to first apply only the resources that the count depends on.
╵
```

Cause
On the first apply, module.acm.certificate_arn is (known after apply) until ACM finishes DNS validation. You used that value in count (and indirectly in for_each on the HTTP listener). Terraform requires count / for_each keys to be known at plan time, so it stopped with Invalid count argument.

Fix
In modules/alb we introduced a boolean enable_https_listener (known from config, not from ACM

```
PS C:\Users\timof\repos\timo\emoji-app\infra\terraform\envs\staging> terraform output staging_app_url
"https://emoji-staging.kogs.link"
╷
│ Warning: Deprecated Parameter
│
│ The parameter "dynamodb_table" is deprecated. Use parameter "use_lockfile" instead.
╵
PS C:\Users\timof\repos\timo\emoji-app\infra\terraform\envs\staging> terraform output alb_dns_name
"emoji-load-balancer-28533277.ap-southeast-2.elb.amazonaws.com"
╷
│ Warning: Deprecated Parameter
│
│ The parameter "dynamodb_table" is deprecated. Use parameter "use_lockfile" instead.
╵
```
