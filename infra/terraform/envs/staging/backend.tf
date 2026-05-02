# Backend wiring is added in Milestone T1 once the S3 bucket and DynamoDB
# lock table exist. Until then, Terraform uses local state inside this
# directory (.terraform/terraform.tfstate), which is fine for the T0 skeleton
# but should never receive real resources.
#
# Planned shape (do not uncomment until T1 prerequisites are met):
#
# terraform {
#   backend "s3" {
#     bucket         = "emoji-app-tfstate-100641718971-ap-southeast-2"
#     key            = "staging/terraform.tfstate"
#     region         = "ap-southeast-2"
#     dynamodb_table = "emoji-app-tflock"
#     encrypt        = true
#   }
# }
