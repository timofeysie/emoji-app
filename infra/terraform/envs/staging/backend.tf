# Backend bootstrapped in Milestone T1.
#
# Prerequisites (created manually before this block was enabled):
#   - S3 bucket: emoji-app-tfstate-100641718971-ap-southeast-2
#     (versioning enabled, public access blocked, SSE-S3 default)
#   - DynamoDB table: emoji-app-tflock (LockID: S, PAY_PER_REQUEST)

terraform {
  backend "s3" {
    bucket         = "emoji-app-tfstate-100641718971-ap-southeast-2"
    key            = "staging/terraform.tfstate"
    region         = "ap-southeast-2"
    dynamodb_table = "emoji-app-tflock"
    encrypt        = true
  }
}
