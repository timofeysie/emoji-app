variable "aws_region" {
  description = "AWS region for all staging resources."
  type        = string
  default     = "ap-southeast-2"
}

variable "environment" {
  description = "Logical environment name used in resource tags."
  type        = string
  default     = "staging"
}

variable "image_uri" {
  description = "Full ECR image URI for the ECS task definition. Pin to an immutable tag or digest; do not use :latest."
  type        = string
  default     = ""
}

variable "openai_secret_enabled" {
  description = "Whether to wire the OpenAI Secrets Manager secret into the task definition. Set true only after the secret exists."
  type        = bool
  default     = false
}

variable "cognito_user_pool_id" {
  description = "Cognito user pool id for the staging environment."
  type        = string
  default     = ""
}

variable "cognito_app_client_id" {
  description = "Cognito app client id for the staging environment."
  type        = string
  default     = ""
}

variable "cognito_region" {
  description = "Region where the Cognito user pool is hosted."
  type        = string
  default     = "ap-southeast-2"
}

variable "certificate_domain_name" {
  description = "Staging public hostname (FQDN). Used for ACM DNS cert and Route 53 alias → ALB."
  type        = string
}

variable "route53_hosted_zone_name" {
  description = "Public Route 53 hosted zone name for DNS validation and alias (e.g. kogs.link)."
  type        = string
}
