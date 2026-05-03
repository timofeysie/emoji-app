variable "environment" {
  description = "Logical environment name; used in IAM role names and secret ARN patterns."
  type        = string
}

variable "aws_region" {
  description = "AWS region where Secrets Manager secrets live (used to construct ARN patterns)."
  type        = string
}

variable "managed_secret_names" {
  description = <<-EOT
    Short names of Secrets Manager secrets the task role should be allowed to
    read, e.g. ["mongodb-uri", "openai-api-key"]. Each becomes
    arn:aws:secretsmanager:<region>:<account>:secret:emoji-app/<env>/<name>*
    in the inline read-secrets policy. The trailing * is intentional so the
    grant survives Secrets Manager rotation, which appends a random suffix.
  EOT
  type        = list(string)
}
