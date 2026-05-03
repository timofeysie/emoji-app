variable "environment" {
  description = "Logical environment name. Currently only used for tagging via provider default_tags."
  type        = string
}

variable "aws_region" {
  description = "Region used for the awslogs log driver configuration."
  type        = string
}

variable "family" {
  description = "ECS task definition family name."
  type        = string
  default     = "emoji-staging-task"
}

variable "container_name" {
  description = "Name of the application container inside the task."
  type        = string
  default     = "emoji-app"
}

variable "container_port" {
  description = "Container TCP port the Express server binds to."
  type        = number
  default     = 3000
}

variable "image_uri" {
  description = <<-EOT
    Full ECR image reference for the container, either tag-pinned
    (e.g. ".../emoji-app:staging-2026-04-27") or digest-pinned
    (e.g. ".../emoji-app@sha256:..."). Avoid :latest under Terraform
    management - it makes plans non-deterministic and rollbacks ambiguous.
  EOT
  type        = string
}

variable "task_cpu" {
  description = "Task-level CPU units (e.g. \"1024\" = 1 vCPU). String per AWS schema."
  type        = string
  default     = "1024"
}

variable "task_memory" {
  description = "Task-level memory in MiB (e.g. \"3072\" = 3 GB). String per AWS schema."
  type        = string
  default     = "3072"
}

variable "log_group_name" {
  description = "CloudWatch log group for the awslogs driver. The module creates this resource and the task definition references it via attribute (not variable) so the two never drift."
  type        = string
  default     = "/ecs/emoji-staging-task"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the application log group. 30 is a reasonable staging default; lower for cost, higher (or 0 = never expire) for audit needs."
  type        = number
  default     = 30
}

variable "cluster_name" {
  description = "ECS cluster name."
  type        = string
  default     = "emoji-staging-cluster"
}

variable "enable_container_insights" {
  description = "Enable CloudWatch Container Insights on the cluster. Adds a small per-task cost in exchange for resource-level metrics."
  type        = bool
  default     = true
}

variable "service_name" {
  description = "ECS service name."
  type        = string
  default     = "emoji-staging-service"
}

variable "desired_count" {
  description = "Number of running tasks the service should maintain. Staging defaults to 1; bump in T9 once autoscaling is wired."
  type        = number
  default     = 1
}

variable "subnet_ids" {
  description = "Subnets the ECS tasks attach ENIs in. Should match the ALB's subnets so traffic doesn't cross AZ boundaries unnecessarily."
  type        = list(string)
}

variable "ecs_security_group_id" {
  description = "Security group attached to the task ENIs. Must allow ingress on the container port from the ALB SG."
  type        = string
}

variable "target_group_arn" {
  description = "ALB target group the service registers running tasks with."
  type        = string
}

variable "health_check_grace_period_seconds" {
  description = "Seconds the service ignores ALB health checks for newly started tasks. Tune up if cold starts are slow."
  type        = number
  default     = 60
}

variable "enable_execute_command" {
  description = "Enable ECS Exec for the service so we can shell into staging tasks for debugging."
  type        = bool
  default     = true
}

variable "wait_for_steady_state" {
  description = "If true, terraform apply blocks until the service reaches steady state. Useful in staging; consider disabling in CI for faster apply turnaround."
  type        = bool
  default     = true
}

variable "execution_role_arn" {
  description = "ARN of the ECS task execution role (ECR pull, CloudWatch logs, secrets injection)."
  type        = string
}

variable "task_role_arn" {
  description = "ARN of the ECS task role used by the running container (Secrets Manager access via inline policy)."
  type        = string
}

variable "mongodb_uri_secret_arn" {
  description = <<-EOT
    Full ARN (with the random suffix Secrets Manager appends) of the
    Mongo URI secret. The secret is expected to store JSON of the form
    {"MONGODB_URI":"mongodb://..."}; the module pins the ECS valueFrom
    to ":MONGODB_URI::" so only that field is injected.
  EOT
  type        = string
}

variable "openai_api_key_secret_arn" {
  description = <<-EOT
    Full ARN of the OpenAI API key secret, or null to omit the
    OPENAI_API_KEY entry entirely. The secret is expected to store JSON of
    the form {"OPENAI_API_KEY":"sk-..."}; the module pins the valueFrom to
    ":OPENAI_API_KEY::". Setting null is supported so the staging env can
    boot a degraded "no AI" task definition if needed.
  EOT
  type        = string
  default     = null
}

variable "node_env" {
  description = "Value of the NODE_ENV env var inside the container."
  type        = string
  default     = "production"
}

variable "disable_auth" {
  description = "Value of the DISABLE_AUTH env var. Server treats anything other than \"true\" as auth-enabled."
  type        = string
  default     = "false"
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID for JWT verification."
  type        = string
}

variable "cognito_app_client_id" {
  description = "Cognito App Client ID for JWT verification."
  type        = string
}

variable "cognito_region" {
  description = "Region of the Cognito User Pool (often the same as aws_region but kept separate for portability)."
  type        = string
}
