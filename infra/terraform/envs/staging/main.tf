provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      app         = "emoji-app"
      environment = var.environment
      managed_by  = "terraform"
    }
  }
}

# Module wiring is added milestone-by-milestone:
#   - T2 enables module.network                (active)
#   - T3 enables module.alb                    (active)
#   - T4 enables module.iam_ecs                (active)
#   - T5 enables module.ecs_service task definition (active; cluster/service in T6)
#   - T7 enables module.acm
#
# Each block stays commented out until the corresponding module has resources
# defined. This keeps `terraform plan` clean during the import-first phase.

module "network" {
  source      = "../../modules/network"
  environment = var.environment
}

# The live ALB was created with only 2 of the 3 default subnets attached.
# We pass that explicit pair to module.alb so the import-first plan stays a
# pure additive-tags baseline. Extending the ALB to the third AZ is an
# availability decision tracked separately, not part of T3 import scope.
locals {
  alb_subnet_ids = [
    "subnet-04d6a20297d1b8357",
    "subnet-0e7030c134b0c450d",
  ]
}

module "alb" {
  source                = "../../modules/alb"
  environment           = var.environment
  vpc_id                = module.network.vpc_id
  subnet_ids            = local.alb_subnet_ids
  alb_security_group_id = module.network.alb_security_group_id
}

module "iam_ecs" {
  source      = "../../modules/iam-ecs"
  environment = var.environment
  aws_region  = var.aws_region

  # Both staging secrets exist (Mongo URI from Milestone 3A, OpenAI key from
  # the T4 -> T5 follow-up). The inline policy is scoped to their wildcard
  # ARNs so it survives Secrets Manager rotation.
  managed_secret_names = [
    "mongodb-uri",
    "openai-api-key",
  ]
}

# Look up the secret ARNs once at the env level so multiple modules can share
# them. Secrets Manager appends a random suffix on creation; .arn returns the
# full suffixed form, which is what ECS needs in the valueFrom field.
data "aws_secretsmanager_secret" "mongodb_uri" {
  name = "emoji-app/${var.environment}/mongodb-uri"
}

data "aws_secretsmanager_secret" "openai_api_key" {
  count = var.openai_secret_enabled ? 1 : 0
  name  = "emoji-app/${var.environment}/openai-api-key"
}

module "ecs_service" {
  source      = "../../modules/ecs-service"
  environment = var.environment
  aws_region  = var.aws_region

  image_uri = var.image_uri

  execution_role_arn = module.iam_ecs.execution_role_arn
  task_role_arn      = module.iam_ecs.task_role_arn

  mongodb_uri_secret_arn    = data.aws_secretsmanager_secret.mongodb_uri.arn
  openai_api_key_secret_arn = var.openai_secret_enabled ? data.aws_secretsmanager_secret.openai_api_key[0].arn : null

  cognito_user_pool_id  = var.cognito_user_pool_id
  cognito_app_client_id = var.cognito_app_client_id
  cognito_region        = var.cognito_region
}
