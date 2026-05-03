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
#   - T5/T6 enables module.ecs_service
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

  # The OpenAI secret does not yet exist in Secrets Manager, but the existing
  # inline policy already grants access to its future ARN. This is fine
  # because IAM policies can reference resources that don't exist yet. See
  # pre-T0 Gap #1 for the secret-creation follow-up.
  managed_secret_names = [
    "mongodb-uri",
    "openai-api-key",
  ]
}

# module "ecs_service" {
#   source                = "../../modules/ecs-service"
#   environment           = var.environment
#   aws_region            = var.aws_region
#   image_uri             = var.image_uri
#   cognito_user_pool_id  = var.cognito_user_pool_id
#   cognito_app_client_id = var.cognito_app_client_id
#   cognito_region        = var.cognito_region
#   execution_role_arn    = module.iam_ecs.execution_role_arn
#   task_role_arn         = module.iam_ecs.task_role_arn
#   target_group_arn      = module.alb.target_group_arn
#   subnet_ids            = module.network.subnet_ids
#   ecs_security_group_id = module.network.ecs_security_group_id
#   openai_secret_enabled = var.openai_secret_enabled
# }
